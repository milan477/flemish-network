const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

walkDir('./src', function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // Supabase queries: .from('people').select('*') -> .from('people').select('*, locations(*)')
    content = content.replace(/\.from\('people'\)\s*\.select\('\*'\)/g, ".from('people').select('*, locations(*)')");
    content = content.replace(/\.from\('organizations'\)\s*\.select\('\*'\)/g, ".from('organizations').select('*, locations(*)')");
    content = content.replace(/\.from\('people'\)\s*\.select\('([^']+)'\)/g, (match, p1) => {
      if (p1 === '*' || p1.includes('locations')) return match;
      return `.from('people').select('${p1}, location_id, locations(*)')`;
    });
    content = content.replace(/\.from\('organizations'\)\s*\.select\('([^']+)'\)/g, (match, p1) => {
      if (p1 === '*' || p1.includes('locations')) return match;
      return `.from('organizations').select('${p1}, location_id, locations(*)')`;
    });

    // Object property replacements for Person/Organization variables
    const vars = ['p', 'person', 'o', 'org', 'organization', 'contact', 'row'];
    vars.forEach(v => {
      // location_city -> locations?.city
      content = content.replace(new RegExp(`\\b${v}\\.location_city\\b`, 'g'), `${v}.locations?.city`);
      // location_state -> locations?.state
      content = content.replace(new RegExp(`\\b${v}\\.location_state\\b`, 'g'), `${v}.locations?.state`);
      // latitude -> locations?.latitude
      content = content.replace(new RegExp(`\\b${v}\\.latitude\\b`, 'g'), `${v}.locations?.latitude`);
      // longitude -> locations?.longitude
      content = content.replace(new RegExp(`\\b${v}\\.longitude\\b`, 'g'), `${v}.locations?.longitude`);
    });

    // Form/state updates where location_city and location_state are destructured or used as keys
    // E.g. editForm.location_city -> editForm.location_id
    // Wait, forms usually need the location_id now. We should be careful about forms.
    // I'll leave forms to manual update or targeted regex.

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Updated', filePath);
    }
  }
});
