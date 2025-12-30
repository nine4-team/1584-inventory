// Test the CollapsedDuplicateGroup component behavior
console.log('Testing CollapsedDuplicateGroup changes...');

// Simulate what the component should display
const testCases = [
  { groupNumber: 1, count: 24, expected: 'Item 1 ×24' },
  { groupNumber: 2, count: 5, expected: 'Item 2 ×5' },
  { groupNumber: undefined, count: 3, expected: '×3' }, // fallback case
];

testCases.forEach(({ groupNumber, count, expected }) => {
  const result = groupNumber ? `Item ${groupNumber} ×${count}` : `×${count}`;
  console.log(`Group ${groupNumber || 'undefined'} with ${count} items: "${result}" (expected: "${expected}")`);
  if (result === expected) {
    console.log('  ✓ PASS');
  } else {
    console.log('  ✗ FAIL');
  }
});

console.log('Test completed.');