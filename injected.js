window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data.type !== 'GENERATE_PDF') return;
  const data = event.data.data;
  const { jsPDF } = window.jspdf || window;
  if (!jsPDF) { alert("jsPDF missing"); return; }

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 36;
  let y = margin;

  // THEME
  const COLORS = {
    userBg: [243, 244, 246], aiBg: [255, 255, 255],
    border: [229, 231, 235], text: [31, 41, 55],
    accent: [0, 0, 0]
  };

  const checkPage = (h) => {
    if (y + h > pageHeight - margin) {
      pdf.addPage();
      y = margin;
      return true;
    }
    return false;
  };

  // HEADER
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text((data.title || 'Chat Export').substring(0, 50), margin, y);
  y += 20;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(100);
  pdf.text(`${data.date} • ${data.messages.length} Messages`, margin, y);
  y += 30;
  pdf.setDrawColor(200);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 30;

  // --- MESSAGES ---
  for (const msg of data.messages) {
    if (!msg.text && msg.images.length === 0) continue;

    const isUser = msg.role === 'user';
    const bubbleWidth = 430;
    const x = isUser ? (pageWidth - margin - bubbleWidth) : margin;
    const padding = 20;

    // CRITICAL FIX: Huge Safety Buffer (60pt) to prevent "outcom" cutoff
    const safeTextWidth = bubbleWidth - 60;

    // PRE-PROCESS TEXT
    let rawText = (msg.text || '').replace(/\*\*/g, '');
    if (msg.codeBlocks) {
      msg.codeBlocks.forEach(b => {
        rawText = rawText.replace(b.id, `\n[CODE: ${b.language}]\n${b.code}\n[ENDCODE]\n`);
      });
    }

    // CALCULATE LINES (Strict Font-Awareness)
    pdf.setFontSize(11);
    const finalLines = [];
    const lines = rawText.split('\n');

    for (let line of lines) {
      line = line.trimEnd();
      if (!line) continue;

      // HEADERS (## Title)
      if (line.includes('## ')) {
        pdf.setFont('helvetica', 'bold');
        const clean = line.replace(/##/g, '').trim().toUpperCase();
        const split = pdf.splitTextToSize(clean, safeTextWidth);
        split.forEach(s => finalLines.push({ text: s, type: 'header' }));
      }
      // BULLETS (• Item)
      else if (line.trim().startsWith('•') || line.trim().startsWith('- ')) {
        pdf.setFont('helvetica', 'normal');
        const split = pdf.splitTextToSize(line.trim(), safeTextWidth);
        split.forEach(s => finalLines.push({ text: s, type: 'bullet' }));
      }
      // CODE MARKERS
      else if (line.startsWith('[CODE:')) {
        finalLines.push({ text: line, type: 'code_meta' });
      }
      else if (line.startsWith('[ENDCODE]')) { /* skip */ }
      // NORMAL TEXT
      else {
        pdf.setFont('helvetica', 'normal');
        const split = pdf.splitTextToSize(line, safeTextWidth);
        split.forEach(s => finalLines.push({ text: s, type: 'text' }));
      }
    }

    // CALCULATE HEIGHT
    const lineHeight = 15;
    const contentHeight = (finalLines.length * lineHeight) + (msg.images.length * 200) + (padding * 2);
    checkPage(contentHeight + 20);

    // DRAW BOX
    pdf.setFillColor(...(isUser ? COLORS.userBg : COLORS.aiBg));
    pdf.setDrawColor(...COLORS.border);
    pdf.roundedRect(x, y, bubbleWidth, contentHeight, 8, 8, 'FD');

    // RENDER CONTENT
    let cy = y + padding + 6;
    let cx = x + padding;
    pdf.setTextColor(...COLORS.text);

    for (const l of finalLines) {
      if (l.type === 'header') {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12); // Slightly bigger for header
        pdf.text(l.text, cx, cy);
        cy += lineHeight + 5;
      }
      else if (l.type === 'bullet') {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        pdf.text(l.text, cx, cy);
        cy += lineHeight;
      }
      else if (l.type === 'code_meta') {
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(10);
        pdf.setTextColor(200, 0, 0); // Red highlight for code label
        pdf.text(l.text.replace('[', '').replace(']', ''), cx, cy);
        pdf.setTextColor(...COLORS.text);
        cy += lineHeight;
      }
      else {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        pdf.text(l.text, cx, cy);
        cy += lineHeight;
      }
    }

    // RENDER IMAGES
    for (const img of msg.images) {
      if (cy + 160 > pageHeight - margin) { pdf.addPage(); cy = margin; }
      try {
        pdf.addImage(img.src, 'JPEG', cx, cy + 5, 200, 150);
        cy += 160;
      } catch (e) {
        pdf.setFontSize(9);
        pdf.setTextColor(0, 0, 255);
        pdf.text('[Image Attachment]', cx, cy + 15);
        cy += 20;
      }
    }

    y += contentHeight + 15;
  }

  pdf.save('Premium_Chat_Export.pdf');
});
