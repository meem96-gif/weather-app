// Weather data comes from Open-Meteo (free, no API key needed)
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

// Weather code -> [label, page theme, icon]
const CODES = {
  0: ["Clear sky", "clear", "☀️"],
  1: ["Mostly clear", "clear", "🌤️"],
  2: ["Partly cloudy", "cloud", "⛅"],
  3: ["Overcast", "cloud", "☁️"],
  45: ["Fog", "cloud", "🌫️"],
  48: ["Icy fog", "cloud", "🌫️"],
  51: ["Light drizzle", "rain", "🌦️"],
  53: ["Drizzle", "rain", "🌦️"],
  55: ["Heavy drizzle", "rain", "🌧️"],
  56: ["Freezing drizzle", "rain", "🌧️"],
  57: ["Freezing drizzle", "rain", "🌧️"],
  61: ["Light rain", "rain", "🌧️"],
  63: ["Rain", "rain", "🌧️"],
  65: ["Heavy rain", "rain", "🌧️"],
  66: ["Freezing rain", "rain", "🌧️"],
  67: ["Freezing rain", "rain", "🌧️"],
  71: ["Light snow", "snow", "🌨️"],
  73: ["Snow", "snow", "❄️"],
  75: ["Heavy snow", "snow", "❄️"],
  77: ["Snow grains", "snow", "❄️"],
  80: ["Light showers", "rain", "🌦️"],
  81: ["Showers", "rain", "🌧️"],
  82: ["Heavy showers", "rain", "🌧️"],
  85: ["Snow showers", "snow", "🌨️"],
  86: ["Heavy snow showers", "snow", "🌨️"],
  95: ["Thunderstorm", "storm", "⛈️"],
  96: ["Thunderstorm with hail", "storm", "⛈️"],
  99: ["Thunderstorm with hail", "storm", "⛈️"],
};

const $ = (id) => document.getElementById(id);
let data = null;     // last weather response
let useF = false;    // false = °C, true = °F

// ---------- helpers ----------
const describe = (code) => CODES[code] || ["Unknown", "cloud", "🌡️"];

function temp(c) {
  const value = useF ? (c * 9) / 5 + 32 : c;
  return `${Math.round(value)}°`;
}

function setStatus(message, isError = false) {
  const el = $("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// ---------- fetching ----------
async function searchCity(name) {
  setStatus("Loading…");
  try {
    const geo = await getJSON(
      `${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=en`
    );
    if (!geo.results || geo.results.length === 0) {
      setStatus(`No city found for "${name}". Check the spelling and try again.`, true);
      return;
    }
    const { latitude, longitude, name: city, admin1, country } = geo.results[0];
    await loadWeather(latitude, longitude, [city, admin1, country].filter(Boolean).join(", "));
  } catch (err) {
    setStatus("Couldn't reach the weather service. Check your internet connection and try again.", true);
  }
}

async function loadWeather(lat, lon, label) {
  const params =
    `latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=5`;
  data = await getJSON(`${WEATHER_URL}?${params}`);
  data.label = label;
  setStatus("");
  render();
}

function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus("Your browser doesn't support location. Search for a city instead.", true);
    return;
  }
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        await loadWeather(pos.coords.latitude, pos.coords.longitude, "Your location");
      } catch (err) {
        setStatus("Couldn't reach the weather service. Check your internet connection and try again.", true);
      }
    },
    () => setStatus("Location access was blocked. Allow it in your browser, or search for a city.", true)
  );
}

// ---------- rendering ----------
function render() {
  if (!data) return;
  const { current, daily } = data;
  const [label, theme] = describe(current.weather_code);

  // After dark, clear and cloudy skies switch to the night theme
  const isNight = current.is_day === 0 && (theme === "clear" || theme === "cloud");
  document.body.dataset.theme = isNight ? "night" : theme;

  $("place").textContent = data.label;
  $("condition").textContent = label;
  $("temp").textContent = temp(current.temperature_2m);
  $("feels").textContent = temp(current.apparent_temperature);
  $("humidity").textContent = `${current.relative_humidity_2m}%`;
  $("wind").textContent = `${Math.round(current.wind_speed_10m)} km/h`;
  $("unit").textContent = useF ? "Show °C" : "Show °F";
  $("unit").setAttribute("aria-pressed", String(useF));

  // Forecast rows. Each bar sits inside the week's overall low-high span.
  const weekLow = Math.min(...daily.temperature_2m_min);
  const weekHigh = Math.max(...daily.temperature_2m_max);
  const span = weekHigh - weekLow || 1;

  $("forecast").innerHTML = daily.time
    .map((date, i) => {
      const lo = daily.temperature_2m_min[i];
      const hi = daily.temperature_2m_max[i];
      const day =
        i === 0
          ? "Today"
          : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
      const [desc, , icon] = describe(daily.weather_code[i]);
      const left = ((lo - weekLow) / span) * 100;
      const width = Math.max(((hi - lo) / span) * 100, 4);
      return `
        <li>
          <span>${day}</span>
          <span role="img" aria-label="${desc}">${icon}</span>
          <span class="track"><span class="bar" style="left:${left}%;width:${width}%"></span></span>
          <span class="range">${temp(lo)} / ${temp(hi)}</span>
        </li>`;
    })
    .join("");

  $("weather").hidden = false;
}

// ---------- events ----------
$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("city").value.trim();
  if (name) searchCity(name);
});

$("locate").addEventListener("click", useMyLocation);

$("unit").addEventListener("click", () => {
  useF = !useF;
  render();
});