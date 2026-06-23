// AWS Amplify configuration for the Rate Engine application
// Values are loaded from window.RATE_ENGINE_CONFIG which is set in the public/config.js file

declare global {
  interface Window {
    RATE_ENGINE_CONFIG: {
      API_ENDPOINT: string;
      REGION: string;
      USER_POOL_ID: string;
      USER_POOL_CLIENT_ID: string;
    };
  }
}

export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: window.RATE_ENGINE_CONFIG?.USER_POOL_ID || '',
      userPoolClientId: window.RATE_ENGINE_CONFIG?.USER_POOL_CLIENT_ID || '',
      loginWith: {
        email: true,
      },
    },
  },
  API: {
    REST: {
      RateEngineAPI: {
        endpoint: window.RATE_ENGINE_CONFIG?.API_ENDPOINT || '',
        region: window.RATE_ENGINE_CONFIG?.REGION || 'us-east-1',
      },
    },
  },
};
