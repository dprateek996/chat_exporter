(function() {
  const checkJsPDF = setInterval(() => {
    if (window.jspdf && window.jspdf.jsPDF) {
      clearInterval(checkJsPDF);
      window.postMessage({ type: 'JSPDF_READY', jsPDFAvailable: true }, '*');
    }
  }, 100);

  /**
   * Sanitize text for PDF output - jsPDF only supports basic Latin characters
   */
  function sanitizeForPDF(text) {
    if (!text) return '';
    
    let cleaned = text;
    
    // Remove zero-width and invisible characters
    cleaned = cleaned
      .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E\u200F]/g, '')
      .replace(/[\u2028\u2029]/g, '\n');
    
    // Remove private use area characters (icons/symbols)
    cleaned = cleaned.replace(/[\uE000-\uF8FF]/g, '');
    
    // Normalize Unicode to ASCII
    const unicodeToAscii = {
      '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
      '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
      '\u2039': '<', '\u203A': '>',
      '\u00AB': '"', '\u00BB': '"',
      '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
      '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ',
      '\u2026': '...',
      '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
      '\u21D2': '=>', '\u21D0': '<=',
      '\u27A4': '->', '\u2794': '->', '\u279C': '->',
      '\u00D7': 'x', '\u00F7': '/',
      '\u2260': '!=', '\u2264': '<=', '\u2265': '>=',
      '\u2713': '[v]', '\u2714': '[v]', '\u2715': '[x]', '\u2716': '[x]',
      '\u00A9': '(c)', '\u00AE': '(R)', '\u2122': '(TM)',
    };
    
    for (const [unicode, ascii] of Object.entries(unicodeToAscii)) {
      cleaned = cleaned.replace(new RegExp(unicode, 'g'), ascii);
    }
    
    // Normalize bullet points to dash
    const bulletChars = /[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB\u25B6\u25BA\u25C6\u25C7\u2605\u2606\u2666\u27A2●○◦◆◇▪▫★☆→➤►]/g;
    cleaned = cleaned.replace(bulletChars, '-');
    
    // Replace accented characters with base letters
    cleaned = cleaned
      .replace(/[\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5]/gi, 'a')
      .replace(/[\u00e8\u00e9\u00ea\u00eb]/gi, 'e')
      .replace(/[\u00ec\u00ed\u00ee\u00ef]/gi, 'i')
      .replace(/[\u00f2\u00f3\u00f4\u00f5\u00f6]/gi, 'o')
      .replace(/[\u00f9\u00fa\u00fb\u00fc]/gi, 'u')
      .replace(/[\u00f1]/gi, 'n')
      .replace(/[\u00e7]/gi, 'c')
      .replace(/[\u00df]/g, 'ss')
      .replace(/[\u00e6]/gi, 'ae')
      .replace(/[\u0153]/gi, 'oe');
    
    // Remove any remaining non-printable or non-ASCII
    cleaned = cleaned.replace(/[^\x20-\x7E\n\t]/g, '');
    
    return cleaned.replace(/  +/g, ' ').trim();
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data.type !== 'GENERATE_PDF') return;

    const data = event.data.data;
    const { jsPDF } = window.jspdf || window;

    if (!jsPDF) {
      alert("jsPDF not available.");
      return;
    }

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 50;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;
      let pageNumber = 1;

      // Helper: ensure space, add new page if needed
      const ensureSpace = (needed = 20) => {
        if (y + needed > pageHeight - margin - 20) {
          addPageFooter();
          pdf.addPage();
          pageNumber++;
          y = margin;
          return true;
        }
        return false;
      };

      // Helper: add page footer
      const addPageFooter = () => {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(150, 150, 150);
        const pageText = `Page ${pageNumber}`;
        const textWidth = pdf.getTextWidth(pageText);
        pdf.text(pageText, (pageWidth - textWidth) / 2, pageHeight - 25);
      };

      // ========== DOCUMENT HEADER ==========
      
      const safeTitle = sanitizeForPDF(data.title) || 'ChatGPT Conversation';
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.setTextColor(30, 30, 30);
      const titleLines = pdf.splitTextToSize(safeTitle, contentWidth);
      titleLines.forEach(line => {
        pdf.text(line, margin, y);
        y += 26;
      });
      y += 5;

      // Metadata
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`Exported: ${data.date}`, margin, y);
      y += 14;
      pdf.text(`${data.stats.total} messages | ${data.stats.words} words`, margin, y);
      y += 20;

      // Separator
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(1);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 30;

      // ========== MESSAGES ==========
      
      const lineHeight = 14;

      for (let msgIdx = 0; msgIdx < data.messages.length; msgIdx++) {
        const msg = data.messages[msgIdx];
        if (!msg.text) continue;

        // Sanitize text
        let text = sanitizeForPDF(msg.text);
        if (!text) continue;

        // Handle code blocks
        if (msg.codeBlocks && msg.codeBlocks.length > 0) {
          msg.codeBlocks.forEach(block => {
            const codeContent = sanitizeForPDF(block.code);
            text = text.replace(block.id, `\n[CODE:${block.language.toUpperCase()}]\n${codeContent}\n[/CODE]\n`);
          });
        }

        // Role header badge
        ensureSpace(40);
        const roleLabel = msg.role === 'user' ? 'USER' : 'ASSISTANT';
        const roleColor = msg.role === 'user' ? [16, 163, 127] : [139, 92, 246];

        pdf.setFillColor(...roleColor);
        pdf.roundedRect(margin, y - 12, 75, 18, 3, 3, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(255, 255, 255);
        pdf.text(roleLabel, margin + 10, y);
        y += 18;

        // Process content
        const lines = text.split('\n');
        let inCode = false;

        for (const rawLine of lines) {
          const line = rawLine.trim();

          // Empty line
          if (!line) {
            y += 8;
            continue;
          }

          // Headers
          const h1Match = line.match(/^#{1,2}\s+(.+)$/);
          if (h1Match) {
            ensureSpace(25);
            y += 8;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            pdf.setTextColor(30, 30, 30);
            const headerLines = pdf.splitTextToSize(h1Match[1], contentWidth);
            headerLines.forEach(hl => {
              pdf.text(hl, margin, y);
              y += 18;
            });
            pdf.setDrawColor(220, 220, 220);
            pdf.line(margin, y - 6, margin + 100, y - 6);
            continue;
          }

          // Code block start
          if (line.match(/^\[CODE:?([A-Z]*)\]$/i)) {
            inCode = true;
            ensureSpace(30);
            y += 5;
            const lang = line.match(/^\[CODE:?([A-Z]*)\]$/i)?.[1] || 'CODE';
            pdf.setFillColor(60, 60, 60);
            pdf.roundedRect(margin, y - 10, contentWidth, 18, 3, 3, 'F');
            pdf.setFont('courier', 'bold');
            pdf.setFontSize(9);
            pdf.setTextColor(200, 200, 200);
            pdf.text(lang, margin + 8, y + 2);
            y += 16;
            continue;
          }

          // Code block end
          if (line.match(/^\[\/CODE\]$/i)) {
            inCode = false;
            y += 10;
            continue;
          }

          // Code content
          if (inCode) {
            ensureSpace(14);
            pdf.setFillColor(245, 245, 245);
            pdf.rect(margin, y - 10, contentWidth, 14, 'F');
            pdf.setFont('courier', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(40, 40, 40);
            const codeLine = line.length > 90 ? line.substring(0, 87) + '...' : line;
            pdf.text(codeLine, margin + 5, y);
            y += 12;
            continue;
          }

          // Numbered list
          const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
          if (numMatch) {
            ensureSpace(lineHeight + 5);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(11);
            pdf.setTextColor(50, 50, 50);
            pdf.text(numMatch[1] + '.', margin, y);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(40, 40, 40);
            const numLines = pdf.splitTextToSize(numMatch[2], contentWidth - 25);
            numLines.forEach((nl, idx) => {
              if (idx > 0) { y += lineHeight; ensureSpace(lineHeight); }
              pdf.text(nl, margin + 22, y);
            });
            y += lineHeight + 3;
            continue;
          }

          // Bullet points
          const bulletMatch = line.match(/^[-*]\s+(.+)$/);
          if (bulletMatch) {
            ensureSpace(lineHeight + 5);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(11);
            pdf.setTextColor(40, 40, 40);
            pdf.setFillColor(80, 80, 80);
            pdf.circle(margin + 4, y - 3, 2, 'F');
            const bulletLines = pdf.splitTextToSize(bulletMatch[1], contentWidth - 20);
            bulletLines.forEach((bl, idx) => {
              if (idx > 0) { y += lineHeight; ensureSpace(lineHeight); }
              pdf.text(bl, margin + 15, y);
            });
            y += lineHeight + 2;
            continue;
          }

          // Regular text
          ensureSpace(lineHeight);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(40, 40, 40);
          const wrapped = pdf.splitTextToSize(line, contentWidth);
          wrapped.forEach(chunk => {
            ensureSpace(lineHeight);
            pdf.text(chunk, margin, y);
            y += lineHeight;
          });
        }

        // Handle images
        if (msg.images && msg.images.length > 0) {
          for (const img of msg.images) {
            try {
              ensureSpace(160);
              if (img.type === 'svg' || img.src?.startsWith('data:image/svg')) {
                const aspectRatio = img.height / img.width;
                const displayWidth = Math.min(img.width, contentWidth - 40);
                const displayHeight = displayWidth * aspectRatio;
                pdf.addImage(img.src, 'SVG', margin, y, displayWidth, displayHeight);
                y += displayHeight + 10;
              } else {
                try {
                  pdf.addImage(img.src, 'JPEG', margin, y, 200, 150);
                  y += 160;
                } catch (e) {
                  pdf.setTextColor(0, 0, 255);
                  pdf.textWithLink('[Image Attachment]', margin, y, { url: img.src });
                  y += 20;
                }
              }
            } catch (e) {
              console.warn("Image embed failed", e);
            }
          }
        }

        y += 20;

        // Separator between messages
        if (msgIdx < data.messages.length - 1) {
          ensureSpace(20);
          pdf.setDrawColor(230, 230, 230);
          pdf.setLineWidth(0.5);
          const sepWidth = 100;
          pdf.line((pageWidth - sepWidth) / 2, y - 10, (pageWidth + sepWidth) / 2, y - 10);
        }
      }

      // Footer on last page
      addPageFooter();

      // Save
      const filename = safeTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50) + ".pdf";
      pdf.save(filename);
      window.postMessage({ type: 'PDF_GENERATED' }, '*');

    } catch (error) {
      console.error("PDF Gen Error:", error);
      alert("Error generating PDF: " + error.message);
    }
  });
})();
