import { useRef, useState } from "react";
import { MapPin, RefreshCw, Search, Trash2, CloudSun } from "lucide-react";
import {
  clearSavedWeatherPlace,
  fetchWeatherForecast,
  getBrowserWeatherStorage,
  readSavedWeatherPlace,
  saveWeatherPlace,
  searchWeatherPlaces,
  weatherDescription,
  type WeatherForecast,
  type WeatherPlace,
} from "../../domain/weather";

function placeLabel(place: WeatherPlace): string {
  return [place.name, place.admin1, place.country].filter(Boolean).join(", ");
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function timeLabel(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
}

function adelaideRefreshLabel(value: number): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Adelaide",
  }).format(new Date(value));
}

function temperature(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}°C`;
}

function buildCurrentSummary(forecast: WeatherForecast): string {
  const details = [
    forecast.current.apparentTemperatureC === null
      ? null
      : `feels like ${temperature(forecast.current.apparentTemperatureC)}`,
    forecast.current.precipitationMm === null
      ? null
      : `${forecast.current.precipitationMm.toFixed(1)} mm recent precipitation`,
    forecast.current.windSpeedKmh === null
      ? null
      : `${Math.round(forecast.current.windSpeedKmh)} km/h wind`,
  ].filter(Boolean);
  return details.join(" · ");
}

export default function WeatherView() {
  const [initialRead] = useState(() =>
    readSavedWeatherPlace(getBrowserWeatherStorage())
  );
  const [place, setPlace] = useState<WeatherPlace | null>(initialRead.place);
  const [storageNotice, setStorageNotice] = useState<string | null>(
    initialRead.error
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [forecastLocation, setForecastLocation] = useState<WeatherPlace | null>(
    null
  );
  const [forecastAt, setForecastAt] = useState<number | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const searchToken = useRef(0);
  const forecastToken = useRef(0);

  async function searchPlaces(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = ++searchToken.current;
    setSearching(true);
    setSearchError(null);
    setSearchMessage(null);
    setResults([]);
    try {
      const found = await searchWeatherPlaces(query);
      if (token !== searchToken.current) return;
      setResults(found);
      if (found.length === 0)
        setSearchMessage("No matching places were found.");
    } catch (error) {
      if (token !== searchToken.current) return;
      setSearchError(
        error instanceof Error
          ? error.message
          : "Place search failed. Try again."
      );
    } finally {
      if (token === searchToken.current) setSearching(false);
    }
  }

  function choosePlace(nextPlace: WeatherPlace) {
    searchToken.current += 1;
    forecastToken.current += 1;
    const saved = saveWeatherPlace(getBrowserWeatherStorage(), nextPlace);
    setPlace(nextPlace);
    setForecast(null);
    setForecastLocation(null);
    setForecastAt(null);
    setForecastError(null);
    setRefreshing(false);
    setResults([]);
    setQuery("");
    setSearchError(null);
    setSearchMessage(null);
    setStorageNotice(
      saved.ok
        ? "Place saved on this browser only; it is not synced or backed up."
        : saved.error
    );
  }

  function clearPlace() {
    searchToken.current += 1;
    forecastToken.current += 1;
    const cleared = clearSavedWeatherPlace(getBrowserWeatherStorage());
    setPlace(null);
    setForecast(null);
    setForecastLocation(null);
    setForecastAt(null);
    setForecastError(null);
    setRefreshing(false);
    setResults([]);
    setStorageNotice(
      cleared.ok ? "Saved place cleared from this browser." : cleared.error
    );
  }

  async function refreshForecast() {
    if (!place) return;
    const requestedPlace = place;
    const token = ++forecastToken.current;
    setRefreshing(true);
    setForecastError(null);
    try {
      const nextForecast = await fetchWeatherForecast(requestedPlace);
      if (token !== forecastToken.current) return;
      setForecast(nextForecast);
      setForecastLocation(requestedPlace);
      setForecastAt(Date.now());
      setForecastError(null);
    } catch (error) {
      if (token !== forecastToken.current) return;
      setForecastError(
        error instanceof Error
          ? error.message
          : "Forecast could not be refreshed. The previous forecast remains visible."
      );
    } finally {
      if (token === forecastToken.current) setRefreshing(false);
    }
  }

  const stale =
    forecast !== null &&
    forecastAt !== null &&
    (forecastError !== null || Date.now() - forecastAt > 6 * 60 * 60 * 1000);
  const selectedLabel = place ? placeLabel(place) : null;

  return (
    <section className="weather-view">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Optional planning context</p>
          <h1>Weather / Forecast</h1>
          <p>
            A seven-day guide for a place you choose. Forecasts can be wrong;
            use this as context, not as a safety alert or an automatic schedule.
          </p>
        </div>
      </header>

      <section
        className="weather-privacy notice"
        aria-label="Weather privacy and provider terms"
      >
        <strong>Before you search or refresh</strong>
        <p>
          Place search sends the name you type to Open-Meteo. Refresh sends the
          selected place coordinates to its forecast service; its terms say
          request logs may contain coordinates and are deleted after 90 days. No
          device location is read. The selected place stays in this browser
          only, not in Workspace sync or backups. This free endpoint is for
          non-commercial use and requires attribution.
        </p>
        <p>
          Weather data by{" "}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo.com
          </a>
          {" · "}
          <a
            href="https://open-meteo.com/en/licence"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0 licence
          </a>
          {" · "}
          <a
            href="https://open-meteo.com/en/terms"
            target="_blank"
            rel="noreferrer"
          >
            terms and privacy
          </a>
        </p>
      </section>

      {storageNotice && (
        <p className="notice weather-status" role="status">
          {storageNotice}
          {(storageNotice.toLowerCase().includes("invalid") ||
            storageNotice.toLowerCase().includes("could not be read")) && (
            <button
              className="button secondary"
              type="button"
              onClick={clearPlace}
            >
              <Trash2 size={15} aria-hidden="true" />
              Clear saved place data
            </button>
          )}
        </p>
      )}

      <section
        className="weather-place-panel"
        aria-labelledby="weather-place-title"
      >
        <div className="weather-section-heading">
          <div>
            <p className="eyebrow">Owner selected</p>
            <h2 id="weather-place-title">Choose a place</h2>
          </div>
          {place && (
            <button
              className="button secondary"
              type="button"
              onClick={clearPlace}
            >
              <Trash2 size={15} aria-hidden="true" />
              Clear place
            </button>
          )}
        </div>

        {place ? (
          <div className="weather-selected-place">
            <MapPin size={18} aria-hidden="true" />
            <div>
              <strong>{selectedLabel}</strong>
              <span>{place.timezone}</span>
            </div>
          </div>
        ) : (
          <p className="muted">
            No place selected. Search by town or city; there is no silent
            geolocation.
          </p>
        )}

        <form className="weather-search-form" onSubmit={searchPlaces}>
          <label className="field">
            <span>Town, city or postcode</span>
            <input
              type="search"
              value={query}
              maxLength={120}
              minLength={2}
              onChange={event => setQuery(event.target.value)}
              placeholder="For example, Adelaide, South Australia"
              autoComplete="off"
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={searching || query.trim().length < 2}
          >
            <Search size={16} aria-hidden="true" />
            {searching ? "Searching…" : "Search places"}
          </button>
        </form>
        {searchError && (
          <p className="weather-error" role="alert">
            {searchError}
          </p>
        )}
        {searchMessage && (
          <p className="muted" role="status">
            {searchMessage}
          </p>
        )}
        {results.length > 0 && (
          <ul className="weather-place-results" aria-label="Matching places">
            {results.map(result => (
              <li key={`${result.latitude}:${result.longitude}:${result.name}`}>
                <button type="button" onClick={() => choosePlace(result)}>
                  <MapPin size={15} aria-hidden="true" />
                  <span>{placeLabel(result)}</span>
                  <small>{result.timezone}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {place && (
        <section
          className="weather-forecast-panel"
          aria-labelledby="forecast-title"
        >
          <div className="weather-section-heading">
            <div>
              <p className="eyebrow">Open-Meteo · seven days</p>
              <h2 id="forecast-title">Forecast for {selectedLabel}</h2>
            </div>
            <button
              className="button primary"
              type="button"
              onClick={refreshForecast}
              disabled={refreshing}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {refreshing
                ? "Refreshing…"
                : forecast
                  ? "Refresh forecast"
                  : "Get forecast"}
            </button>
          </div>
          <p className="muted">
            Refresh is manual. Weather is not saved as history and never changes
            task dates or status.
          </p>
          {forecastError && (
            <p className="weather-error" role="alert">
              {forecastError}
              {forecast && " The previous forecast remains visible."}
            </p>
          )}
          {forecast && forecastAt !== null && (
            <div className="weather-results" aria-live="polite">
              <div className={`weather-current${stale ? " is-stale" : ""}`}>
                <div className="weather-current-icon">
                  <CloudSun size={26} aria-hidden="true" />
                </div>
                <div className="weather-current-main">
                  <p className="eyebrow">Current conditions</p>
                  <strong>{temperature(forecast.current.temperatureC)}</strong>
                  <span>
                    {weatherDescription(forecast.current.weatherCode)}
                  </span>
                  <small>
                    {timeLabel(forecast.current.time)} · {forecast.timezone}
                  </small>
                </div>
                <div className="weather-current-details">
                  {buildCurrentSummary(forecast) || "No additional details"}
                </div>
                <div className="weather-refresh-meta">
                  <span>
                    Refreshed {adelaideRefreshLabel(forecastAt)} Adelaide time
                  </span>
                  {stale && <strong>May be stale</strong>}
                </div>
              </div>

              <ul className="weather-days" aria-label="Seven-day forecast">
                {forecast.days.map(day => (
                  <li key={day.date}>
                    <strong>{dateLabel(day.date)}</strong>
                    <span>{weatherDescription(day.weatherCode)}</span>
                    <span>
                      {temperature(day.lowC)} – {temperature(day.highC)}
                    </span>
                    <small>
                      Rain chance{" "}
                      {day.precipitationProbability === null
                        ? "—"
                        : `${Math.round(day.precipitationProbability)}%`}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
