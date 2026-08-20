const { createClient } = require('redis');  
  
let redisClient;  
let isRedisConnected = false;  
  
async function connectRedis() {  
  if (redisClient) return redisClient;  
  
  redisClient = createClient({  
    url: process.env.REDIS_URL  
  });  
  
  redisClient.on('error', (err) => {
    console.error('[Redis] Error:', err.message);  
    isRedisConnected = false;  
  });  
  
  redisClient.on('connect', () => {
    console.log('[Redis] Connected successfully.');  
    isRedisConnected = true;  
  });  
  
  try {  
    await redisClient.connect();  
  } catch (err) {  
    console.error('[Redis] Failed to connect initially:', err.message);  
  }  
  
  return redisClient;  
}  
  
function getRedisClient() {  
  return redisClient;  
}  
  
function isConnected() {  
  return isRedisConnected;  
}  
  
module.exports = { connectRedis, getRedisClient, isConnected }; 
