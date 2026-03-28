/*
  Kussharo Sauna Club - Availability Calendar Server

  How to run:
    node server.js

  Then open http://localhost:8000 in your browser.
*/

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = 8000;

const AIRHOST_ICAL_URL =
  "https://api2.airhost.co/rooms/31f56c8f-f277-4ee4-948f-96d4067d4de7.ics";

// Fetch a URL and return the text
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// Convert iCal date string to YYYY-MM-DD
function toDateString(str) {
  if (/^\d{8}$/.test(str)) {
    return str.slice(0, 4) + "-" + str.slice(4, 6) + "-" + str.slice(6);
  }
  const match = str.match(/^(\d{4})(\d{2})(\d{2})T/);
  if (match) {
    return match[1] + "-" + match[2] + "-" + match[3];
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  return str;
}

// Parse iCal text into booking objects
function parseICal(text) {
  const bookings = [];
  const events = text.split("BEGIN:VEVENT");

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    let checkIn = "";
    let checkOut = "";
    let summary = "";

    for (const rawLine of event.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("DTSTART")) {
        checkIn = line.split(":").pop().trim();
      } else if (line.startsWith("DTEND")) {
        checkOut = line.split(":").pop().trim();
      } else if (line.startsWith("SUMMARY")) {
        summary = line.split(":").slice(1).join(":").trim();
      }
    }

    if (checkIn && checkOut) {
      checkIn = toDateString(checkIn);
      checkOut = toDateString(checkOut);
      if (checkIn && checkOut) {
        bookings.push({ checkIn, checkOut, summary });
      }
    }
  }

  return bookings;
}

// Classify AirHost booking by reservation code
function classifyBooking(summary) {
  const lower = (summary || "").toLowerCase();

  // Blocked or not available
  if (lower.includes("blocked") || lower.includes("not available")) {
    return { type: "blocked", ota: "none", guestName: "" };
  }

  // Extract reservation code from parentheses, e.g. "Guest Name (HMxxxxx)"
  const code = (summary || "").match(/\(([^)]+)\)/);
  const codeStr = code ? code[1] : "";
  const guestName = (summary || "").replace(/\s*\([^)]*\)/, "").trim();

  if (codeStr.startsWith("HM")) {
    return { type: "reserved", ota: "airbnb", guestName };
  }
  if (/^\d+$/.test(codeStr)) {
    return { type: "reserved", ota: "booking.com", guestName };
  }
  if (/^R\d+$/.test(codeStr)) {
    return { type: "reserved", ota: "direct", guestName };
  }

  // Unknown code but has a name = reservation
  if (guestName) {
    return { type: "reserved", ota: "other", guestName };
  }

  return { type: "blocked", ota: "none", guestName: "" };
}

// Fetch all bookings from AirHost
async function fetchAllBookings() {
  const text = await fetchURL(AIRHOST_ICAL_URL);
  const bookings = parseICal(text);

  return bookings.map((b) => {
    const info = classifyBooking(b.summary);
    return {
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      type: info.type,
      ota: info.ota,
      guestName: info.guestName,
    };
  });
}

// Simple file server + API
const server = http.createServer(async (req, res) => {
  if (req.url === "/api/bookings") {
    try {
      const bookings = await fetchAllBookings();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(bookings));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("File not found");
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      }
    });
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  Kussharo Sauna Club - Calendar Server");
  console.log(`  Open http://localhost:${PORT} in your browser`);
  console.log("");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
