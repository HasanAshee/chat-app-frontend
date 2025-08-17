import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { SocketIoModule, SocketIoConfig } from 'ngx-socket-io';
import { environment } from '../environments/environment';

const config: SocketIoConfig = { url: environment.apiUrl, options: {} };

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),

    // 3. Añade el proveedor del SocketIoModule aquí
    importProvidersFrom(SocketIoModule.forRoot(config))
  ]
};
