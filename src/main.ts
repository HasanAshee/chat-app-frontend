import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';

console.log('main.ts: Iniciando bootstrap...');

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
