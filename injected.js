(function() {
  // Wait for jsPDF to load
  const checkJsPDF = setInterval(() => {
    if (window.jspdf && window.jspdf.jsPDF) {
      clearInterval(checkJsPDF);
      window.postMessage({ type: 'JSPDF_READY', jsPDFAvailable: true }, '*');
      console.log("[Injected Script] jsPDF ready");
    } else if (window.jsPDF) {
      clearInterval(checkJsPDF);
      window.postMessage({ type: 'JSPDF_READY', jsPDFAvailable: true }, '*');
      console.log("[Injected Script] jsPDF ready (legacy)");
    }
  }, 100);

  // Helper function to clean and normalize text
  function cleanText(text) {
    if (!text) return '';
    
    // Remove all problematic Unicode characters
    return text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
      .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '') // Remove zero-width spaces
      .replace(/[\u2060-\u206F]/g, '') // Remove word joiners
      .replace(/\u00A0/g, ' ') // Replace non-breaking space with regular space
      .replace(/\u2014/g, '-') // Replace em dash
      .replace(/\u2013/g, '-') // Replace en dash
      .replace(/[\u2018\u2019]/g, "'") // Replace smart quotes
      .replace(/[\u201C\u201D]/g, '"') // Replace smart double quotes
      .replace(/\u2026/g, '...') // Replace ellipsis
      .replace(/\s+/g, ' ') // Collapse multiple spaces into one
      .trim();
  }

  // Listen for PDF generation requests
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data.type !== 'GENERATE_PDF') return;

    const messages = event.data.messages;
    const { jsPDF } = window.jspdf || window;

    if (!jsPDF) {
      alert("jsPDF not available in page context");
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
      const margin = 40;
      // Reduce content width slightly to prevent cutting off
      const contentWidth = pageWidth - (margin * 2) - 10; 
      let yPosition = margin;

      // Title
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.setTextColor(0, 0, 0);
      pdf.text('ChatGPT Conversation', margin, yPosition);
      yPosition += 20;

      // Date
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(100);
      const date = new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      pdf.text(date, margin, yPosition);
      yPosition += 20;

      pdf.setDrawColor(200);
      pdf.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 30;

      // Footer function
      function addFooter() {
        const pageNum = pdf.internal.getCurrentPageInfo().pageNumber;
        pdf.setFontSize(9);
        pdf.setTextColor(150, 150, 150);
        pdf.setFont('helvetica', 'normal');
        const pageText = 'Page ' + pageNum;
        const textWidth = pdf.getTextWidth(pageText);
        pdf.text(pageText, (pageWidth - textWidth) / 2, pageHeight - 30);
      }

      // Check if new page needed
      function checkNewPage(height) {
        if (yPosition + height > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
          return true;
        }
        return false;
      }

      let questionNum = 0;

      // Process messages
      messages.forEach((msg, index) => {
        const isUser = msg.role === 'user';
        
        if (isUser) {
          questionNum++;
        }

        // Clean the text thoroughly
        const cleanedText = cleanText(msg.text);
        
        // Skip if empty after cleaning
        if (!cleanedText || cleanedText.length === 0) {
          console.log('[PDF] Skipping empty message');
          return;
        }

        // Role header
        checkNewPage(30);
        
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(0, 0, 0);
        
        const label = isUser ? 'Question ' + questionNum + ':' : 'Answer ' + questionNum + ':';
        pdf.text(label, margin, yPosition);
        yPosition += 15;

        // Message content
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(40);

        // Split text properly using jsPDF's built-in function
        const lines = pdf.splitTextToSize(cleanedText, contentWidth);

        // Draw each line
        lines.forEach(line => {
          checkNewPage(14);
          pdf.text(line, margin, yPosition);
          yPosition += 14;
        });

        yPosition += 20;
      });

      // Add footer to last page
      addFooter();

      // Save
      const timestamp = new Date().toISOString().slice(0, 10);
      pdf.save('chatgpt_conversation_' + timestamp + '.pdf');
      
      console.log("[Injected Script] PDF generated successfully - " + messages.length + " messages");
      window.postMessage({ type: 'PDF_GENERATED' }, '*');
      
    } catch (error) {
      console.error("[Injected Script] PDF generation error:", error);
      alert("Error generating PDF: " + error.message);
    }
  });
})();