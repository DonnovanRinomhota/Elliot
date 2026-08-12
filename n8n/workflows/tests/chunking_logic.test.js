const TARGET_CHARS = 1000;

function chunkText(text) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > TARGET_CHARS && current) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? current + '\n\n' + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Test 1: normal multi-paragraph FAQ doc
const test1 = `We are open Monday through Friday, 9am to 6pm.

Our pricing starts at $500 for a basic consultation and scales based on property value.

` + 'This is a longer paragraph. '.repeat(30) + `

We offer viewings by appointment only, and same-day requests are usually accommodated within a few hours if an agent is available.`;

const chunks1 = chunkText(test1);
console.log('Test 1 - normal doc:');
console.log('  chunks:', chunks1.length);
chunks1.forEach((c, i) => console.log(`  chunk ${i}: ${c.length} chars`));

// Test 2: empty text (should produce empty array, caller should throw)
const chunks2 = chunkText('   \n\n   \n\n  ');
console.log('Test 2 - empty text:', chunks2.length, 'chunks (expect 0)');

// Test 3: single short paragraph
const chunks3 = chunkText('Just one short line.');
console.log('Test 3 - single short para:', chunks3.length, 'chunks (expect 1)');

// Test 4: no blank-line separators at all (one giant paragraph over target)
const chunks4 = chunkText('word '.repeat(500));
console.log('Test 4 - single huge paragraph, no separators:', chunks4.length, 'chunks (expect 1, since chunker only splits AT paragraph boundaries)');
console.log('  chunk 0 length:', chunks4[0].length, '(exceeds target since no split point exists)');
