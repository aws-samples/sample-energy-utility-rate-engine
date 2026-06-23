import React from 'react'
import ReactDOM from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import App from './App.tsx'
import './index.css'

// Configure Amplify with Cognito and API settings from runtime config
// Config is loaded from /config.js which sets window.RATE_ENGINE_CONFIG
const config = (window as any).RATE_ENGINE_CONFIG || {};
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: config.USER_POOL_ID || '',
      userPoolClientId: config.USER_POOL_CLIENT_ID || '',
      loginWith: {
        email: true,
      },
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
