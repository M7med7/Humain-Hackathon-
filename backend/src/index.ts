import app from './app';
import https from 'https';

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Keep-alive mechanism to prevent Render free-tier sleep
  const backendUrl = process.env.RENDER_EXTERNAL_URL;
  if (backendUrl) {
    console.log(`Keep-alive configured for: ${backendUrl}`);
    const pingInterval = 14 * 60 * 1000; // 14 minutes
    
    setInterval(() => {
      console.log('Sending keep-alive ping...');
      https.get(`${backendUrl}/health`, (res) => {
        if (res.statusCode === 200) {
          console.log('Keep-alive ping successful');
        } else {
          console.error(`Keep-alive ping failed with status: ${res.statusCode}`);
        }
      }).on('error', (err) => {
        console.error('Keep-alive ping error:', err.message);
      });
    }, pingInterval);
  }
});
