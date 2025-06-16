const API_URL = 'https://echoes-server.onrender.com/';

// --- ADD THIS NEW CODE ---
const testCreateBtn = document.getElementById('test-create-btn');

testCreateBtn.addEventListener('click', async () => {
  const fakeEchoData = {
    w3w_address: 'filled.count.soap',
    audio_url: 'https://example.com/audio/fake-echo-1.mp3'
  };

  console.log('Sending fake echo data:', fakeEchoData);

  try {
    const response = await fetch(`${API_URL}/echoes`, {
      method: 'POST', // We are SENDING data
      headers: {
        'Content-Type': 'application/json' // Tell the server we're sending JSON
      },
      body: JSON.stringify(fakeEchoData) // The actual data, converted to a string
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const newEcho = await response.json();
    console.log('Success! Received new echo from server:', newEcho);
    alert(`Successfully created echo with ID: ${newEcho.id}`);

  } catch (error) {
    console.error('Error creating fake echo:', error);
    alert('Failed to create echo. Check the console.');
  }
});