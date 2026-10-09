import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideSumi } from 'sumi-ui/core';

import { routes } from './routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    // Placeholders until the per-app design is decided in tkober/sumi-ui#25:
    // waves + seigaiha for the reading flow, the koi swims in the same water.
    provideSumi({ accent: 'yamabuki', motif: 'waves', pattern: 'seigaiha', companion: 'koi' }),
  ],
};
