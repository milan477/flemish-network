const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('public/us_cities.csv');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const outPath = 'supabase/migrations/20260324000005_import_locations.sql';
  fs.writeFileSync(outPath, '-- Migration: Import locations\n\nTRUNCATE TABLE locations CASCADE;\n\n');

  let isFirst = true;
  let batch = [];
  
  // Headers: ID,STATE_CODE,STATE_NAME,CITY,COUNTY,LATITUDE,LONGITUDE
  for await (const line of rl) {
    if (isFirst) {
      isFirst = false;
      continue;
    }
    
    // Simple CSV parser for this specific format
    const matches = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g);
    if (!matches || matches.length < 7) continue;
    
    const parts = matches.map(m => m.replace(/^,/, '').replace(/^"(.*)"$/, '$1').replace(/""/g, '"'));
    
    const state = parts[1].replace(/'/g, "''");
    const city = parts[3].replace(/'/g, "''");
    const lat = parseFloat(parts[5]);
    const lng = parseFloat(parts[6]);
    
    if (isNaN(lat) || isNaN(lng)) continue;

    batch.push(`('${city}', '${state}', ${lat}, ${lng})`);
    
    if (batch.length >= 1000) {
      fs.appendFileSync(outPath, `INSERT INTO locations (city, state, latitude, longitude) VALUES\n${batch.join(',\n')} ON CONFLICT (city, state) DO NOTHING;\n\n`);
      batch = [];
    }
  }
  
  if (batch.length > 0) {
    fs.appendFileSync(outPath, `INSERT INTO locations (city, state, latitude, longitude) VALUES\n${batch.join(',\n')} ON CONFLICT (city, state) DO NOTHING;\n\n`);
  }
  console.log('Done writing migration.');
}

processLineByLine();
