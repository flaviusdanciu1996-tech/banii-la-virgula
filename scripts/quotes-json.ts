// Writes dist/quotes.json from src/lib/quotes.ts so the notification function reads the same list.
import { writeFileSync } from 'node:fs'
import { QUOTES } from '../src/lib/quotes.ts'
writeFileSync('dist/quotes.json', JSON.stringify(QUOTES))
console.log(`quotes.json: ${QUOTES.length} citate`)
