const HOLIDAYS = {
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

const SPECIAL_SESSIONS = {
  "2026-11-08": {
    label: "Muhurat Trading",
    open: 18 * 60,
    close: 19 * 60 + 15,
  },
};

function istParts(now = new Date()) {
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
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return { date, weekday: get("weekday"), mins };
}

function nseSession(now = new Date()) {
  const { date, weekday, mins } = istParts(now);
  const special = SPECIAL_SESSIONS[date];
  if (special) {
    const live = mins >= special.open && mins <= special.close;
    return {
      live,
      mode: live ? "LIVE" : "LTP",
      label: live ? "LIVE / EXECUTABLE" : "LTP / THEORETICAL",
      reason: live
        ? `${special.label} ${String(Math.floor(special.open / 60)).padStart(2, "0")}:${String(special.open % 60).padStart(2, "0")}–${String(Math.floor(special.close / 60)).padStart(2, "0")}:${String(special.close % 60).padStart(2, "0")} IST`
        : `${special.label} is not in session`,
      date,
    };
  }
  const holiday = HOLIDAYS[date];
  if (holiday) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: `${holiday} holiday`, date };
  }
  if (weekday === "Sat" || weekday === "Sun") {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "Weekend — NIFTY F&O closed", date };
  }
  const open = 9 * 60 + 15;
  const close = 15 * 60 + 30;
  if (mins < open) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "Before 09:15 IST open", date };
  }
  if (mins > close) {
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

function marketOpen(now = new Date()) {
  return nseSession(now).live;
}

function mcxSession(now = new Date()) {
  const { date, weekday, mins } = istParts(now);
  const holiday = HOLIDAYS[date];
  if (holiday) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: `${holiday} holiday`, date };
  }
  if (weekday === "Sat" || weekday === "Sun") {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "Weekend — MCX closed", date };
  }
  const open = 9 * 60;
  const close = 23 * 60 + 30;
  if (mins < open) {
    return { live: false, mode: "LTP", label: "LTP / THEORETICAL", reason: "Before 09:00 IST MCX open", date };
  }
  if (mins > close) {
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

module.exports = { nseSession, marketOpen, mcxSession, silverOverlapSession, HOLIDAYS, SPECIAL_SESSIONS };
