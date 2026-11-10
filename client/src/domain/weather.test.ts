import { describe, expect, it, vi } from "vitest";
import {
  clearSavedWeatherPlace,
  fetchWeatherForecast,
  makeGeocodingUrl,
  makeWeatherForecastUrl,
  parseWeatherForecast,
  readSavedWeatherPlace,
  saveWeatherPlace,
  searchWeatherPlaces,
  weatherDescription,
  WEATHER_PLACE_STORAGE_KEY,
  type WeatherPlace,
  type WeatherStorage,
} from "./weather";

const adelaide: WeatherPlace = {
  name: "Adelaide",
  admin1: "South Australia",
  country: "Australia",
  countryCode: "AU",
  latitude: -34.9285,
  longitude: 138.6007,
  timezone: "Australia/Adelaide",
};

function forecastPayload() {
  return {
    timezone: "Australia/Adelaide",
    current: {
      time: "2026-10-30T12:00",
      temperature_2m: 21.4,
      apparent_temperature: 20.7,
      precipitation: 0,
      weather_code: 2,
      wind_speed_10m: 12.6,
    },
    daily: {
      time: ["2026-10-30", "2026-10-31"],
      weather_code: [2, 61],
      temperature_2m_max: [24.1, 19.2],
      temperature_2m_min: [13.3, 11.4],
      precipitation_probability_max: [10, 80],
    },
  };
}

function memoryStorage(initial?: Record<string, string>): WeatherStorage {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: key => {
      data.delete(key);
    },
  };
}

function mockFetch(payload: unknown, status = 200) {
  const urls: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetcher, urls };
}

describe("weather provider integration", () => {
  it("sends a place query only to the fixed geocoding endpoint", async () => {
    const { fetcher, urls } = mockFetch({
      results: [
        {
          name: "Adelaide",
          admin1: "South Australia",
          country: "Australia",
          country_code: "AU",
          latitude: -34.9285,
          longitude: 138.6007,
          timezone: "Australia/Adelaide",
        },
      ],
    });

    const places = await searchWeatherPlaces(
      "Adelaide, South Australia",
      fetcher
    );

    expect(places).toEqual([adelaide]);
    const request = new URL(urls[0]);
    expect(request.origin).toBe("https://geocoding-api.open-meteo.com");
    expect(request.searchParams.get("name")).toBe("Adelaide, South Australia");
    expect(request.searchParams.get("count")).toBe("5");
    expect(request.searchParams.get("format")).toBe("json");
  });

  it("uses explicit place coordinates, seven days and the location-resolved timezone", () => {
    const url = makeWeatherForecastUrl(adelaide);

    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe(String(adelaide.latitude));
    expect(url.searchParams.get("longitude")).toBe(String(adelaide.longitude));
    expect(url.searchParams.get("timezone")).toBe("auto");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("current")).toContain("weather_code");
    expect(url.searchParams.get("daily")).toContain(
      "precipitation_probability_max"
    );
  });

  it("parses current conditions and daily forecast without retaining provider extras", async () => {
    const { fetcher } = mockFetch(forecastPayload());
    const result = await fetchWeatherForecast(adelaide, fetcher);

    expect(result.timezone).toBe("Australia/Adelaide");
    expect(result.current.temperatureC).toBe(21.4);
    expect(result.current.weatherCode).toBe(2);
    expect(result.days).toHaveLength(2);
    expect(result.days[1]).toMatchObject({
      date: "2026-10-31",
      weatherCode: 61,
      precipitationProbability: 80,
    });
  });

  it("rejects malformed timezones, mismatched arrays and invalid daily dates", () => {
    const valid = forecastPayload();
    expect(parseWeatherForecast(valid)).not.toBeNull();
    expect(
      parseWeatherForecast({
        ...valid,
        timezone: "not/a-timezone",
      })
    ).toBeNull();
    expect(
      parseWeatherForecast({
        ...valid,
        daily: { ...valid.daily, temperature_2m_max: [24.1] },
      })
    ).toBeNull();
    expect(
      parseWeatherForecast({
        ...valid,
        daily: { ...valid.daily, time: ["2026-02-30", "2026-10-31"] },
      })
    ).toBeNull();
  });

  it("rejects unsafe search input before making a provider request", () => {
    expect(() => makeGeocodingUrl("A")).toThrow(/2 and 120/);
    expect(() => makeGeocodingUrl("Adelaide\n&latitude=0")).toThrow();
  });

  it("maps documented WMO codes and handles unknown future codes safely", () => {
    expect(weatherDescription(95)).toBe("Thunderstorm");
    expect(weatherDescription(0)).toBe("Clear sky");
    expect(weatherDescription(42)).toBe("Conditions unavailable");
  });
});

describe("local-only selected weather place", () => {
  it("saves and reads only a strictly validated place record", () => {
    const storage = memoryStorage();
    expect(saveWeatherPlace(storage, adelaide)).toEqual({
      ok: true,
      error: null,
    });
    expect(readSavedWeatherPlace(storage)).toEqual({
      place: adelaide,
      error: null,
    });
    expect(
      JSON.parse(storage.getItem(WEATHER_PLACE_STORAGE_KEY) ?? "{}")
    ).toEqual({
      version: 1,
      place: adelaide,
    });
  });

  it("does not overwrite malformed saved data without an explicit clear", () => {
    const storage = memoryStorage({ [WEATHER_PLACE_STORAGE_KEY]: "not-json" });
    const result = saveWeatherPlace(storage, adelaide);
    expect(result.ok).toBe(false);
    expect(storage.getItem(WEATHER_PLACE_STORAGE_KEY)).toBe("not-json");
  });

  it("rejects extra keys even when the saved place is empty", () => {
    const raw = JSON.stringify({ version: 1, place: null, unexpected: true });
    const storage = memoryStorage({ [WEATHER_PLACE_STORAGE_KEY]: raw });

    expect(readSavedWeatherPlace(storage)).toEqual({
      place: null,
      error: "Saved weather-place data is not recognized and was not changed.",
    });
    expect(storage.getItem(WEATHER_PLACE_STORAGE_KEY)).toBe(raw);
  });

  it("clears a saved place only through the explicit remove helper", () => {
    const storage = memoryStorage({
      [WEATHER_PLACE_STORAGE_KEY]: JSON.stringify({
        version: 1,
        place: adelaide,
      }),
    });
    expect(clearSavedWeatherPlace(storage)).toEqual({ ok: true, error: null });
    expect(readSavedWeatherPlace(storage)).toEqual({
      place: null,
      error: null,
    });
  });
});
