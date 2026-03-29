const SPREADSHEET_ID = "1RYIov4-DkN8Rewdk9zSPwERioPhDQHwFjOMxOFzuiwo";

async function fetchSheetCSV(sheetName) {
  const url =
    "https://docs.google.com/spreadsheets/d/" +
    SPREADSHEET_ID +
    "/gviz/tq?tqx=out:csv&sheet=" +
    encodeURIComponent(sheetName);

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch sheet: " + response.status);
  }

  return await response.text();
}

function parseCSV(text) {
  const rows = [];
  let current = "";
  let inQuotes = false;
  const lines = text.split("\n");

  for (const line of lines) {
    if (inQuotes) {
      current += "\n" + line;
    } else {
      current = line;
    }

    const quoteCount = (current.match(/"/g) || []).length;
    inQuotes = quoteCount % 2 !== 0;

    if (!inQuotes) {
      const row = [];
      let cell = "";
      let q = false;
      for (let i = 0; i < current.length; i++) {
        const ch = current[i];
        if (ch === '"') {
          if (q && current[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            q = !q;
          }
        } else if (ch === "," && !q) {
          row.push(cell);
          cell = "";
        } else {
          cell += ch;
        }
      }
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      current = "";
    }
  }

  return rows;
}

function normalizeDate(dateStr) {
  const parts = dateStr.split("/");
  if (parts.length !== 3) return dateStr;
  const y = parts[0];
  const m = parts[1].padStart(2, "0");
  const d = parts[2].padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function findRowByLabel(rows, label) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c].includes(label)) return r;
    }
  }
  return -1;
}

function findDateRow(rows) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(rows[r][c])) return r;
    }
  }
  return -1;
}

function extractAvailability(rows, expectedYear) {
  const bookings = [];

  const dateRowIdx = findDateRow(rows);
  const rateRowIdx = findRowByLabel(rows, "稼働率/day");

  if (dateRowIdx === -1 || rateRowIdx === -1) return bookings;

  const dateRow = rows[dateRowIdx];
  const rateRow = rows[rateRowIdx];

  for (let i = 0; i < dateRow.length; i++) {
    const dateStr = dateRow[i];
    if (!dateStr || !/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(dateStr)) continue;

    let normalized = normalizeDate(dateStr);
    // Fix year if it doesn't match expected year
    if (expectedYear && !normalized.startsWith(String(expectedYear))) {
      normalized = expectedYear + normalized.slice(4);
    }
    const rate = rateRow[i];

    if (rate && rate !== "0%") {
      bookings.push({
        checkIn: normalized,
        checkOut: normalized,
        type: "reserved",
        ota: "direct",
      });
    }
  }

  return bookings;
}

module.exports = async function handler(req, res) {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Fetch from current month through November 2026
    const months = [];
    let y = currentYear;
    let m = currentMonth;
    while (y < 2026 || (y === 2026 && m <= 11)) {
      months.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
    }

    const results = await Promise.all(
      months.map(async function ({ year, month }) {
        try {
          const sheetName = year + "." + String(month).padStart(2, "0");
          const text = await fetchSheetCSV(sheetName);
          const rows = parseCSV(text);
          return extractAvailability(rows, year);
        } catch (e) {
          return [];
        }
      })
    );

    const allBookings = results.flat();

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    res.status(200).json(allBookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
