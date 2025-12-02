document.getElementById('exportBtn').addEventListener('click', () => {
  const status = document.getElementById('status');
  
  // Open ChatGPT in a new tab
  chrome.tabs.create({ 
    url: 'https://chatgpt.com/' 
  }, (tab) => {
    status.className = 'status success';
    status.textContent = '✓ Opening ChatGPT... Click the green button to export!';
    
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  });
});