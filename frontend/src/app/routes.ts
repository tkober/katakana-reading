import { Routes } from '@angular/router';

import { DictionariesComponent } from './dictionaries.component';
import { PracticeComponent } from './practice.component';
import { SettingsComponent } from './settings.component';
import { StatsComponent } from './stats.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'practice' },
  {
    path: 'practice',
    component: PracticeComponent,
    title: 'Practice · Katakana Trainer',
  },
  { path: 'stats', component: StatsComponent, title: 'Stats · Katakana Trainer' },
  {
    path: 'dictionaries',
    component: DictionariesComponent,
    title: 'Dictionaries · Katakana Trainer',
  },
  {
    path: 'settings',
    component: SettingsComponent,
    title: 'Settings · Katakana Trainer',
  },
  { path: '**', redirectTo: 'practice' },
];
