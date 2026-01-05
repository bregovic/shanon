
import React from 'react'
import ReactDOM from 'react-dom/client'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import App from './App.tsx'
// Remove TranslationContext import if not used, or keep for side-effects if any, but unlikely
import './index.css'
import './App.css'
import './i18n'

console.log(`Shanon App Version: ${__APP_VERSION__} (${__APP_BUILD_DATE__})`);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <FluentProvider theme={webLightTheme}>
            <App />
        </FluentProvider>
    </React.StrictMode>,
)
