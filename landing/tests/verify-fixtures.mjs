import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html','utf8');
const examples = JSON.parse(html.match(/id="landing-samples">([\s\S]*?)<\/script>/)[1]);
const source = JSON.parse(fs.readFileSync('../data/matching_results.json','utf8'));
for (const example of examples) {
  const original = source.find(r => r.update_id === example.id);
  assert.equal(example.text, original.field_text);
  assert.deepEqual(example.candidates, original.candidate_matches);
  assert.equal(example.score, original.confidence_score);
}
assert.equal(fs.readFileSync('_headers','utf8'),fs.readFileSync('public/_headers','utf8'));
assert(!/SUPABASE|service_role|eyJ[A-Za-z0-9_-]{15}/.test(fs.readFileSync('assets/evaluator-demo.js','utf8')));
console.log('Fixture/source integrity: 3 examples match; headers synchronized; no credential patterns in demo script.');
