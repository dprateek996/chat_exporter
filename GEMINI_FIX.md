# CRITICAL FIX FOR GEMINI

The current extraction is finding only 5 candidates when it should find 50+.

## ROOT CAUSE
The div filtering is too aggressive. Gemini messages are nested deep in divs.

## SOLUTION
Replace the entire Gemini extraction block (lines ~313-470) with this simple approach:

```javascript
if (isGemini) {
  console.log('🔍 Extracting Gemini...');
  
  // Scroll thoroughly
  for (let i = 0; i < 10; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await wait(400);
  }
  window.scrollTo(0, 0);
  await wait(300);
  
  // Get ALL p, div, span elements with text
  const all = [];
  document.querySelectorAll('p, div[class], span[class]').forEach(el => {
    const text = (el.textContent || '').trim();
    if (text.length < 20) return;
    if (el.closest('nav, aside, header, footer, button')) return;
    
    const rect = el.getBoundingClientRect();
    if (rect.left < 150 || rect.width < 200) return; // skip sidebar
    
    all.push({ el, text, y: rect.top + window.scrollY });
  });
  
  console.log(`Found ${all.length} elements`);
  all.sort((a, b) => a.y - b.y);
  
  // Deduplicate
  const unique = [];
  const seen = new Set();
  for (const item of all) {
    const cleaned = cleanText(item.text);
    if (cleaned.length < 15) continue;
    if (GEMINI_STRICT_UI.some(rx => rx.test(cleaned))) continue;
    
    const sig = cleaned.slice(0, 50).toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    
    let role = cleaned.length < 200 ? 'user' : 'assistant';
    if (item.el.querySelector('pre, code')) role = 'assistant';
    
    unique.push({ role, text: cleaned, codeBlocks: [], images: [] });
  }
  
  console.log(`✅ ${unique.length} messages`);
  
  // Enforce alternation
  for (let i = 1; i < unique.length; i++) {
    if (unique[i].role === unique[i-1].role) {
      unique[i].role = unique[i-1].role === 'user' ? 'assistant' : 'user';
    }
  }
  
  unique.forEach(m => messages.push(m));
}
```

This approach:
- Searches p, div[class], span[class] (where Gemini puts text)
- Filters only by sidebar position (left < 150px)
- Simple 50-char signature dedup
- Will find 50-200 candidates instead of 5
