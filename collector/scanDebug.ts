import { debugQiraCandidates } from './qiraScanner';

const debug = debugQiraCandidates();
console.log('Qira scan roots:');
for (const root of debug.roots) console.log(`- ${root}`);
console.log('');

for (const project of debug.projects) {
  console.log(`## ${project.name}`);
  if (!project.candidates.length) {
    console.log('  no candidates');
    continue;
  }
  for (const candidate of project.candidates) {
    console.log(`  score=${candidate.score} path=${candidate.path}`);
    console.log(`    ${candidate.reasons.join(' | ')}`);
  }
}
