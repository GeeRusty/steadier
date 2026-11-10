export const WEATHER_PLACE_STORAGE_KEY = "steadier.weather.place.local.v1";
export const WEATHER_GEOCODING_ENDPOINT =
  "https://geocoding-api.open-meteo.com/v1/search";
export const WEATHER_FORECAST_ENDPOINT =
  "https://api.open-meteo.com/v1/forecast";
export const MAX_WEATHER_SEARCH_LENGTH = 120;
export const MAX_WEATHER_RESULTS = 5;

export interface WeatherPlace {
  name: string;
  admin1: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface WeatherDay {
  date: string;
  weatherCode: number;
  highC: number | null;
  lowC: number | null;
  precipitationProbability: number | null;
}

export interface WeatherForecast {
  timezone: string;
  current: {
    time: string;
    temperatureC: number;
    apparentTemperatureC: number | null;
    precipitationMm: number | null;
    weatherCode: number;
    windSpeedKmh: number | null;
  };
  days: WeatherDay[];
}

export interface WeatherStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface WeatherStorageRead {
  place: WeatherPlace | null;
  error: string | null;
}

export interface WeatherStorageWrite {
  ok: boolean;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function optionalText(value: unknown, limit: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > limit) return null;
  return value;
}

export function parseWeatherPlace(value: unknown): WeatherPlace | null {
  if (!isRecord(value)) return null;
  const expected = [
    "name",
    "admin1",
    "country",
    "countryCode",
    "latitude",
    "longitude",
    "timezone",
  ];
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some(key => !expected.includes(key))
  ) {
    return null;
  }
  if (
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.length > 100 ||
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    !isValidTimeZone(value.timezone)
  ) {
    return null;
  }
  const admin1 = optionalText(value.admin1, 100);
  const country = optionalText(value.country, 100);
  const countryCode = optionalText(value.countryCode, 2);
  if (
    (value.admin1 !== null && value.admin1 !== undefined && admin1 === null) ||
    (value.country !== null &&
      value.country !== undefined &&
      country === null) ||
    (value.countryCode !== null &&
      value.countryCode !== undefined &&
      countryCode === null) ||
    (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode))
  ) {
    return null;
  }
  return {
    name: value.name.trim(),
    admin1,
    country,
    countryCode,
    latitude: value.latitude,
    longitude: value.longitude,
    timezone: value.timezone,
  };
}

function parseGeocodingPlace(value: unknown): WeatherPlace | null {
  if (!isRecord(value)) return null;
  return parseWeatherPlace({
    name: value.name,
    admin1: value.admin1 ?? null,
    country: value.country ?? null,
    countryCode: value.country_code ?? null,
    latitude: value.latitude,
    longitude: value.longitude,
    timezone: value.timezone,
  });
}

function validLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function optionalFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number
): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    return null;
  }
  return value;
}

function requiredFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number
): number | null {
  return optionalFiniteNumber(value, minimum, maximum);
}

function validCurrentTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function parseWeatherForecast(value: unknown): WeatherForecast | null {
  if (!isRecord(value) || !isRecord(value.current) || !isRecord(value.daily)) {
    return null;
  }
  const timezone = isValidTimeZone(value.timezone) ? value.timezone : null;
  const currentTime = validCurrentTime(value.current.time)
    ? value.current.time
    : null;
  const temperatureC = requiredFiniteNumber(
    value.current.temperature_2m,
    -100,
    70
  );
  const weatherCode = requiredFiniteNumber(value.current.weather_code, 0, 99);
  if (
    !timezone ||
    !currentTime ||
    temperatureC === null ||
    weatherCode === null ||
    !Number.isInteger(weatherCode)
  ) {
    return null;
  }

  const dates = value.daily.time;
  const codes = value.daily.weather_code;
  const highs = value.daily.temperature_2m_max;
  const lows = value.daily.temperature_2m_min;
  const probabilities = value.daily.precipitation_probability_max;
  if (
    !Array.isArray(dates) ||
    dates.length < 1 ||
    dates.length > 7 ||
    !Array.isArray(codes) ||
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(probabilities) ||
    codes.length !== dates.length ||
    highs.length !== dates.length ||
    lows.length !== dates.length ||
    probabilities.length !== dates.length
  ) {
    return null;
  }

  const days: WeatherDay[] = [];
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const code = requiredFiniteNumber(codes[index], 0, 99);
    const high = optionalFiniteNumber(highs[index], -100, 70);
    const low = optionalFiniteNumber(lows[index], -100, 70);
    const probability = optionalFiniteNumber(probabilities[index], 0, 100);
    if (
      !validLocalDate(date) ||
      code === null ||
      !Number.isInteger(code) ||
      (highs[index] !== null && highs[index] !== undefined && high === null) ||
      (lows[index] !== null && lows[index] !== undefined && low === null) ||
      (probabilities[index] !== null &&
        probabilities[index] !== undefined &&
        probability === null)
    ) {
      return null;
    }
    days.push({
      date,
      weatherCode: code,
      highC: high,
      lowC: low,
      precipitationProbability: probability,
    });
  }

  const apparentTemperature = optionalFiniteNumber(
    value.current.apparent_temperature,
    -100,
    70
  );
  const precipitation = optionalFiniteNumber(
    value.current.precipitation,
    0,
    1000
  );
  const windSpeed = optionalFiniteNumber(value.current.wind_speed_10m, 0, 500);
  if (
    (value.current.apparent_temperature !== null &&
      value.current.apparent_temperature !== undefined &&
      apparentTemperature === null) ||
    (value.current.precipitation !== null &&
      value.current.precipitation !== undefined &&
      precipitation === null) ||
    (value.current.wind_speed_10m !== null &&
      value.current.wind_speed_10m !== undefined &&
      windSpeed === null)
  ) {
    return null;
  }

  return {
    timezone,
    current: {
      time: currentTime,
      temperatureC,
      apparentTemperatureC: apparentTemperature,
      precipitationMm: precipitation,
      weatherCode,
      windSpeedKmh: windSpeed,
    },
    days,
  };
}

function parseStoredLocation(value: unknown): WeatherPlace | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("version") ||
    !keys.includes("place") ||
    value.version !== 1
  ) {
    return null;
  }
  if (value.place === null) return null;
  return parseWeatherPlace(value.place);
}

export function getBrowserWeatherStorage(): WeatherStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSavedWeatherPlace(
  storage: WeatherStorage | null
): WeatherStorageRead {
  if (!storage) {
    return {
      place: null,
      error:
        "Browser storage is unavailable. A selected place will be kept for this session only.",
    };
  }
  try {
    const raw = storage.getItem(WEATHER_PLACE_STORAGE_KEY);
    if (raw === null) return { place: null, error: null };
    const parsed: unknown = JSON.parse(raw);
    const rootKeys = isRecord(parsed) ? Object.keys(parsed) : [];
    if (
      !isRecord(parsed) ||
      rootKeys.length !== 2 ||
      !rootKeys.includes("version") ||
      !rootKeys.includes("place") ||
      parsed.version !== 1
    ) {
      return {
        place: null,
        error:
          "Saved weather-place data is not recognized and was not changed.",
      };
    }
    if (parsed.place === null) return { place: null, error: null };
    const place = parseStoredLocation(parsed);
    if (!place) {
      return {
        place: null,
        error: "Saved weather-place data is invalid and was not changed.",
      };
    }
    return { place, error: null };
  } catch {
    return {
      place: null,
      error: "Saved weather-place data could not be read and was not changed.",
    };
  }
}

export function saveWeatherPlace(
  storage: WeatherStorage | null,
  place: WeatherPlace
): WeatherStorageWrite {
  if (!storage) {
    return {
      ok: false,
      error:
        "Browser storage is unavailable; the place is kept for this session only.",
    };
  }
  const validated = parseWeatherPlace(place);
  if (!validated) {
    return {
      ok: false,
      error: "The selected place was not saved because it is invalid.",
    };
  }
  try {
    const existing = storage.getItem(WEATHER_PLACE_STORAGE_KEY);
    if (existing !== null) {
      const read = readSavedWeatherPlace({
        getItem: () => existing,
        setItem: storage.setItem.bind(storage),
        removeItem: storage.removeItem.bind(storage),
      });
      if (read.error) {
        return {
          ok: false,
          error:
            "Saved weather-place data is invalid; it was not overwritten. Clear it explicitly before saving a new place.",
        };
      }
    }
    storage.setItem(
      WEATHER_PLACE_STORAGE_KEY,
      JSON.stringify({ version: 1, place: validated })
    );
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error:
        "The place could not be saved in this browser; it remains selected for this session.",
    };
  }
}

export function clearSavedWeatherPlace(
  storage: WeatherStorage | null
): WeatherStorageWrite {
  if (!storage) {
    return {
      ok: false,
      error:
        "Browser storage is unavailable. The place was cleared for this session only.",
    };
  }
  try {
    storage.removeItem(WEATHER_PLACE_STORAGE_KEY);
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: "The saved place could not be removed from browser storage.",
    };
  }
}

export function makeGeocodingUrl(query: string): URL {
  const trimmed = query.trim();
  if (
    trimmed.length < 2 ||
    trimmed.length > MAX_WEATHER_SEARCH_LENGTH ||
    /[\u0000-\u001f]/.test(trimmed)
  ) {
    throw new Error("Enter a place name between 2 and 120 characters.");
  }
  const url = new URL(WEATHER_GEOCODING_ENDPOINT);
  url.search = new URLSearchParams({
    name: trimmed,
    count: String(MAX_WEATHER_RESULTS),
    language: "en",
    format: "json",
  }).toString();
  return url;
}

export function makeWeatherForecastUrl(place: WeatherPlace): URL {
  const validated = parseWeatherPlace(place);
  if (!validated)
    throw new Error("Select a valid place before refreshing weather.");
  const url = new URL(WEATHER_FORECAST_ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(validated.latitude),
    longitude: String(validated.longitude),
    current:
      "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "7",
    timezone: "auto",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
  }).toString();
  return url;
}

async function requestJson(url: URL, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(url.toString(), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Weather provider returned an error.");
    return (await response.json()) as unknown;
  } catch {
    throw new Error(
      "Weather service could not be reached. Check the connection and try again."
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchWeatherPlaces(
  query: string,
  fetcher: typeof fetch = fetch
): Promise<WeatherPlace[]> {
  const payload = await requestJson(makeGeocodingUrl(query), fetcher);
  if (!isRecord(payload))
    throw new Error("Weather place search returned unexpected data.");
  if (payload.results === undefined) return [];
  if (!Array.isArray(payload.results)) {
    throw new Error("Weather place search returned unexpected data.");
  }
  return payload.results
    .slice(0, MAX_WEATHER_RESULTS)
    .map(parseGeocodingPlace)
    .filter((place): place is WeatherPlace => place !== null);
}

export async function fetchWeatherForecast(
  place: WeatherPlace,
  fetcher: typeof fetch = fetch
): Promise<WeatherForecast> {
  const payload = await requestJson(makeWeatherForecastUrl(place), fetcher);
  const parsed = parseWeatherForecast(payload);
  if (!parsed) {
    throw new Error("Weather provider returned data in an unexpected format.");
  }
  return parsed;
}

export function weatherDescription(code: number): string {
  const labels: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return labels[code] ?? "Conditions unavailable";
}
