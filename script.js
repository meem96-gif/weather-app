// Weather data comes from Open-Meteo (free, no API key needed)
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

// Weather code -> [label, theme, icon]
const CODES = {
  0: ["Clear sky", "clear", "☀️"], 1: ["Mostly clear", "clear", "🌤️"],
  2: ["Partly cloudy", "cloud", "⛅"], 3: ["Overcast", "cloud", "☁️"],
  45: ["Fog", "cloud", "🌫️"], 48: ["Icy fog", "cloud", "🌫️"],
  51: ["Light drizzle", "rain", "🌦️"], 53: ["Drizzle", "rain", "🌦️"], 55: ["Heavy drizzle", "rain", "🌧️"],
  56: ["Freezing drizzle", "rain", "🌧️"], 57: ["Freezing drizzle", "rain", "🌧️"],
  61: ["Light rain", "rain", "🌧️"], 63: ["Rain", "rain", "🌧️"], 65: ["Heavy rain", "rain", "🌧️"],
  66: ["Freezing rain", "rain", "🌧️"], 67: ["Freezing rain", "rain", "🌧️"],
  71: ["Light snow", "snow", "🌨️"], 73: ["Snow", "snow", "❄️"], 75: ["Heavy snow", "snow", "❄️"], 77: ["Snow grains", "snow", "❄️"],
  80: ["Light showers", "rain", "🌦️"], 81: ["Showers", "rain", "🌧️"], 82: ["Heavy showers", "rain", "🌧️"],
  85: ["Snow showers", "snow", "🌨️"], 86: ["Heavy snow showers", "snow", "🌨️"],
  95: ["Thunderstorm", "storm", "⛈️"], 96: ["Thunderstorm with hail", "storm", "⛈️"], 99: ["Thunderstorm with hail", "storm", "⛈️"],
};

const $ = (id) => document.getElementById(id);
let data = null;
let useF = false;

const describe = (code) => CODES[code] || ["Unknown", "cloud", "🌡️"];
const temp = (c) => `${Math.round(useF ? (c * 9) / 5 + 32 : c)}°`;

function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// ---------- sky: WebGL shader (gradient sky, layered clouds, rain on glass) ----------
const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform vec3 uTop, uBot;
uniform float uTime, uCover, uRain, uSnow, uLight, uWarm, uFlash;
#define S(a,b,t) smoothstep(a,b,t)

float h21(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
vec3 N13(float p){ vec3 q=fract(vec3(p)*vec3(.1031,.11369,.13787)); q+=dot(q,q.yzx+19.19); return fract(vec3((q.x+q.y)*q.z,(q.x+q.z)*q.y,(q.y+q.z)*q.x)); }
float N(float t){ return fract(sin(t*12345.564)*7658.76); }
float Saw(float b,float t){ return S(0.,b,t)*(1.-S(b,1.,t)); }

float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y);
}
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }

float snowfall(vec2 uv,float t){
  float s=0.;
  for(int i=0;i<3;i++){
    float fi=float(i);
    vec2 p=uv*(7.+fi*6.);
    p.y+=t*(.5+fi*.3);
    p.x+=sin(t*.4+fi*3.+p.y*.6)*.4;
    vec2 id=floor(p);
    vec2 f=fract(p)-.5;
    float h=h21(id+fi*31.);
    vec2 o=(vec2(h,fract(h*91.7))-.5)*.5;
    s+=(1.-S(0.,.1+.03*fi,length(f-o)))*step(.4,h)*(.55+.2*fi);
  }
  return s;
}

// Sky: vertical gradient, warm horizon at dawn/dusk, sun glow, stars, 3 cloud layers
vec3 scene(vec2 uv,float t){
  vec3 col=mix(uBot,uTop,S(0.,1.,uv.y));
  col+=vec3(.95,.5,.2)*uWarm*pow(clamp(1.-uv.y,0.,1.),3.)*.6;
  vec2 sp=vec2(uRes.x/uRes.y*.78,.8);
  float d=length(uv-sp);
  col+=vec3(1.,.85,.55)*(exp(-d*4.)*.5+exp(-d*20.)*.9)*uLight*(1.-uCover)*(1.-uCover);
  float dark=(1.-uLight)*(1.-uCover);
  vec2 g=uv*60.;
  float rs=h21(floor(g));
  float star=step(.975,rs)*(1.-S(0.,.35,length(fract(g)-.5)))*(.6+.4*sin(t*2.+rs*60.));
  col+=vec3(star)*dark*S(.15,.7,uv.y);
  vec3 cc=mix(uBot,vec3(1.),.5)*mix(.3,1.,uLight);
  cc=mix(cc,uTop*.9+.04,uCover*.55);
  for(int i=0;i<3;i++){
    float fi=float(i);
    vec2 p=vec2(uv.x*(.9+fi*.5)+t*(.01+fi*.008)+fi*7.,uv.y*(1.7+fi*.5)+fi*3.);
    float c=S(.64-uCover*.36,.96-uCover*.3,fbm(p));
    col=mix(col,cc*(1.-.1*fi),c*(.45+.15*fi));
  }
  return col;
}

// Rain on glass (based on the "Heartfelt" drop technique): a drop mask, then the scene is
// sampled through the drop's surface normal, so each drop bends what is behind it.
vec2 DropLayer(vec2 uv,float t){
  vec2 UV=uv;
  uv.y+=t*.75;
  vec2 a=vec2(6.,1.);
  vec2 grid=a*2.;
  vec2 id=floor(uv*grid);
  uv.y+=N(id.x);
  id=floor(uv*grid);
  vec3 n=N13(id.x*35.2+id.y*2376.1);
  vec2 st=fract(uv*grid)-vec2(.5,0.);
  float x=n.x-.5;
  float y=UV.y*20.;
  x+=sin(y+sin(y))*(.5-abs(x))*(n.z-.5);
  x*=.7;
  y=(Saw(.85,fract(t+n.z))-.5)*.9+.5;
  float d=length((st-vec2(x,y))*a.yx);
  float mainDrop=1.-S(0.,.4,d);
  float r=sqrt(1.-S(y,1.,st.y));
  float cd=abs(st.x-x);
  float trail=(1.-S(.15*r*r,.23*r+.001,cd))*S(-.02,.02,st.y-y)*r*r;
  float yy=fract(UV.y*10.)+(st.y-.5);
  float droplets=1.-S(0.,.3,length(st-vec2(x,yy)));
  return vec2(mainDrop+droplets*r*S(-.02,.02,st.y-y),trail);
}
float StaticDrops(vec2 uv,float t){
  uv*=40.;
  vec2 id=floor(uv);
  uv=fract(uv)-.5;
  vec3 n=N13(id.x*107.45+id.y*3543.654);
  float d=length(uv-(n.xy-.5)*.7);
  return (1.-S(0.,.3,d))*fract(n.z*10.)*Saw(.025,fract(t+n.z));
}
float Drops(vec2 uv,float t,float l0,float l1,float l2){
  float s=StaticDrops(uv,t)*l0;
  float m1=DropLayer(uv,t).x*l1;
  float m2=DropLayer(uv*1.85,t).x*l2;
  return S(.3,1.,s+m1+m2);
}

void main(){
  vec2 frag=gl_FragCoord.xy;
  vec2 sv=frag/uRes.y;
  vec3 col;
  if(uRain>.02){
    vec2 uv=(frag-.5*uRes)/uRes.y*.8;
    float tt=uTime*.2;
    float l0=S(-.5,1.,uRain)*2.;
    float l1=S(.25,.75,uRain);
    float l2=S(0.,.5,uRain);
    float c=Drops(uv,tt,l0,l1,l2);
    float cx=Drops(uv+vec2(.001,0.),tt,l0,l1,l2);
    float cy=Drops(uv+vec2(0.,.001),tt,l0,l1,l2);
    vec2 n=vec2(cx-c,cy-c);
    col=scene(sv+n*10.+vec2(0.,.06*c),uTime);
    vec3 N3=normalize(vec3(-n*70.,1.));
    float spec=pow(clamp(dot(N3,normalize(vec3(-.35,.55,.75))),0.,1.),50.)*S(.05,.4,c);
    float rim=S(0.,.5,c)*(1.-S(.5,1.,c));
    col*=1.-.22*rim;
    col+=vec3(spec)*.9;
    col*=1.-.1*uRain;
  } else {
    col=scene(sv,uTime);
  }
  col+=vec3(snowfall(sv,uTime))*uSnow;
  col+=vec3(.7,.75,1.)*uFlash;
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const mixArr = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// [day top, day bottom, night top, night bottom]
const SKY = {
  clear: ["#2b7fd8", "#a6d8ff", "#050b1f", "#16264d"],
  cloud: ["#6f8195", "#b3c0cc", "#0c1320", "#1c2738"],
  rain:  ["#47535f", "#8a96a1", "#090e16", "#19212b"],
  storm: ["#272a37", "#575c6c", "#06070d", "#151724"],
  snow:  ["#6f86a0", "#bccbda", "#0f192a", "#2a3a52"],
  idle:  ["#4f7fb0", "#a9c6e0", "#0a1226", "#1b2a48"],
};
const COVER = { clear: 0.08, cloud: 0.6, rain: 0.8, storm: 0.95, snow: 0.7, idle: 0.3 };
const CODE_COVER = { 0: 0.03, 1: 0.2, 2: 0.4, 3: 0.75, 45: 0.9, 48: 0.9 };
const LIGHT_RAIN = [51, 53, 56, 61, 66, 80];

function skyTarget(current, daily) {
  const code = current ? current.weather_code : -1;
  const theme = current ? describe(code)[1] : "idle";
  let light = current ? current.is_day : 1, warm = 0;
  const rise = daily && daily.sunrise && daily.sunrise[0];
  const set = daily && daily.sunset && daily.sunset[0];
  if (current && rise && set) {
    const mins = (s) => { const [h, m] = s.slice(11, 16).split(":"); return +h * 60 + +m; };
    const now = mins(current.time), r = mins(rise), s = mins(set);
    light = smooth((now - r + 40) / 80) * smooth((s + 40 - now) / 80);
    warm = Math.max(0, 1 - Math.abs(now - r) / 70, 1 - Math.abs(now - s) / 70);
  }
  const p = SKY[theme];
  return {
    top: mixArr(hex(p[0]), hex(p[2]), 1 - light),
    bot: mixArr(hex(p[1]), hex(p[3]), 1 - light),
    cover: CODE_COVER[code] ?? COVER[theme],
    rain: theme === "rain" || theme === "storm" ? (LIGHT_RAIN.includes(code) ? 0.5 : 0.9) : 0,
    snow: theme === "snow" ? ([71, 77].includes(code) ? 0.55 : 1) : 0,
    light, warm, storm: theme === "storm",
  };
}

const sky = (() => {
  const cv = $("sky");
  const gl = cv.getContext("webgl", { antialias: false });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {};
  let goal = null, prog = null, flash = 0, raf = 0;
  const t0 = performance.now();
  const loc = {};

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
    return s;
  }

  if (gl) {
    const v = compile(gl.VERTEX_SHADER, VS), f = compile(gl.FRAGMENT_SHADER, FS);
    if (v && f) {
      prog = gl.createProgram();
      gl.attachShader(prog, v);
      gl.attachShader(prog, f);
      gl.linkProgram(prog);
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const a = gl.getAttribLocation(prog, "p");
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
        ["uRes", "uTop", "uBot", "uTime", "uCover", "uRain", "uSnow", "uLight", "uWarm", "uFlash"]
          .forEach((n) => (loc[n] = gl.getUniformLocation(prog, n)));
      } else { console.error(gl.getProgramInfoLog(prog)); prog = null; }
    } else cv.style.display = "none";
  } else cv.style.display = "none";

  function resize() {
    const k = Math.min(window.devicePixelRatio || 1, 1.25);
    cv.width = Math.round(window.innerWidth * k);
    cv.height = Math.round(window.innerHeight * k);
    if (prog) gl.viewport(0, 0, cv.width, cv.height);
    if (prog && reduce) frame(0);
  }

  function frame(now) {
    const k = reduce ? 1 : 0.04;
    for (const key of ["cover", "rain", "snow", "light", "warm"]) state[key] += (goal[key] - state[key]) * k;
    state.top = state.top.map((v, i) => v + (goal.top[i] - v) * k);
    state.bot = state.bot.map((v, i) => v + (goal.bot[i] - v) * k);
    if (goal.storm && !reduce && Math.random() < 0.005) flash = 0.9;
    flash *= 0.9;
    gl.uniform2f(loc.uRes, cv.width, cv.height);
    gl.uniform3fv(loc.uTop, state.top);
    gl.uniform3fv(loc.uBot, state.bot);
    gl.uniform1f(loc.uTime, reduce ? 3 : (now - t0) / 1000);
    gl.uniform1f(loc.uCover, state.cover);
    gl.uniform1f(loc.uRain, state.rain);
    gl.uniform1f(loc.uSnow, state.snow);
    gl.uniform1f(loc.uLight, state.light);
    gl.uniform1f(loc.uWarm, state.warm);
    gl.uniform1f(loc.uFlash, flash);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduce) raf = requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();

  return {
    set(target) {
      const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
      document.documentElement.style.setProperty("--top", css(target.top));
      document.documentElement.style.setProperty("--bot", css(target.bot));
      const first = !goal;
      goal = target;
      if (!prog) return;
      if (first) Object.assign(state, target);
      if (reduce) frame(0);
      else if (!raf) raf = requestAnimationFrame(frame);
    },
  };
})();

sky.set(skyTarget(null, null));

// ---------- fetching ----------
async function searchCity(name) {
  setStatus("Loading…");
  try {
    const geo = await getJSON(`${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=en`);
    if (!geo.results || geo.results.length === 0) {
      setStatus(`No city found for "${name}". Check the spelling and try again.`, true);
      return;
    }
    const { latitude, longitude, name: city, admin1, country } = geo.results[0];
    await loadWeather(latitude, longitude, [city, admin1, country].filter(Boolean).join(", "));
  } catch (err) {
    console.error(err);
    setStatus("Couldn't reach the weather service. Check your internet connection and try again.", true);
  }
}

async function loadWeather(lat, lon, label) {
  const params =
    `latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
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
        console.error(err);
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

  document.body.dataset.theme = theme;
  sky.set(skyTarget(current, daily));

  $("place").textContent = data.label;
  $("condition").textContent = label;
  $("temp").textContent = temp(current.temperature_2m);
  $("feels").textContent = temp(current.apparent_temperature);
  $("humidity").textContent = `${current.relative_humidity_2m}%`;
  $("wind").textContent = `${Math.round(current.wind_speed_10m)} km/h`;
  $("unit").textContent = useF ? "Show °C" : "Show °F";
  $("unit").setAttribute("aria-pressed", String(useF));

  $("forecast").innerHTML = daily.time
    .map((date, i) => {
      const day = i === 0 ? "Today" : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
      const [desc, , icon] = describe(daily.weather_code[i]);
      return `
        <li>
          <span class="day">${day}</span>
          <span class="ico" role="img" aria-label="${desc}">${icon}</span>
          <span class="hi">${temp(daily.temperature_2m_max[i])}</span>
          <span class="lo">${temp(daily.temperature_2m_min[i])}</span>
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
$("unit").addEventListener("click", () => { useF = !useF; render(); });