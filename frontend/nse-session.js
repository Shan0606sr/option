const NSE_HOLIDAYS = {
  "2026-01-26": "Republic Day",
  "2026-03-03": "Holi",
  "2026-03-26": "Shri Ram Navami",
  "2026-03-31": "Shri Mahavir Jayanti",
  "2026-04-03": "Good Friday",
  "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2026-05-01": "Maharashtra Day",
  "2026-05-28": "Bakri Id",
  "2026-06-26": "Muharram",
  "2026-09-14": "Ganesh Chaturthi",
  "2026-10-02": "Mahatma Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-10": "Diwali-Balipratipada",
  "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
  "2026-12-25": "Christmas",
};

const NSE_SPECIAL = {
  "2026-11-08": { label: "Muhurat Trading", open: 18 * 60, close: 19 * 60 + 15 },
};

function nseSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = get("weekday");
  const mins = Number(get("hour")) * 60 + Number(get("minute"));

  const special = NSE_SPECIAL[date];
  if (special) {
    const live = mins >= special.open && mins <= special.close;
    return {
      live,
      mode: live ? "LIVE" : "LTP",
      label: live ? "LIVE / EXECUTABLE" : "LTP / THEORETICAL",
      reason: live ? `${special.label} special session` : `${special.label} is not in session`,
      date,
    };
  }
  if (NSE_HOLIDAYS[date]) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: `${NSE_HOLIDAYS[date]} holiday`, date };
  }
  if (weekday === "Sat" || weekday === "Sun") {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "Weekend — NIFTY F&O closed", date };
  }
  if (mins < 9 * 60 + 15) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "Before 09:15 IST open", date };
  }
  if (mins > 15 * 60 + 30) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "After 15:30 IST close", date };
  }
  return {
    live: true,
    mode: "LIVE",
    label: "LIVE / EXECUTABLE",
    reason: "NIFTY F&O session 09:15–15:30 IST",
    date,
  };
}

window.nseSession = nseSession;

function mcxSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = get("weekday");
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  if (NSE_HOLIDAYS[date]) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: `${NSE_HOLIDAYS[date]} holiday`, date };
  }
  if (weekday === "Sat" || weekday === "Sun") {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "Weekend — MCX closed", date };
  }
  if (mins < 9 * 60) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "Before 09:00 IST MCX open", date };
  }
  if (mins > 23 * 60 + 30) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "After 23:30 IST MCX close", date };
  }
  return {
    live: true,
    mode: "LIVE",
    label: "LIVE / EXECUTABLE",
    reason: "MCX session 09:00–23:30 IST",
    date,
  };
}

function silverOverlapSession(now = new Date()) {
  const nse = nseSession(now);
  const mcx = mcxSession(now);
  const live = Boolean(nse.live && mcx.live);
  if (live) {
    return {
      live: true,
      mode: "LIVE",
      label: "LIVE / EXECUTABLE",
      reason: "NSE ETF and MCX overlap 09:15–15:30 IST",
      date: nse.date,
      nse,
      mcx,
    };
  }
  if (!nse.live && mcx.live) {
    return {
      live: false,
      mode: "LTP",
      label: "LTP / THEORETICAL",
      reason: "ETF session closed — do not compare the ETF last price with live MCX",
      date: nse.date,
      nse,
      mcx,
    };
  }
  const weekend = /Weekend/.test(nse.reason || "") || /Weekend/.test(mcx.reason || "");
  return {
    live: false,
    mode: "LTP",
    label: "LTP / THEORETICAL",
    reason: weekend ? "Weekend — NSE ETF and MCX closed" : (nse.reason || mcx.reason),
    date: nse.date,
    nse,
    mcx,
  };
}

window.mcxSession = mcxSession;
window.silverOverlapSession = silverOverlapSession;
