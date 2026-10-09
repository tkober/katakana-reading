import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SumiHotkeyHelp } from 'sumi-ui/core';
import { SUMI_LAYOUT, SumiAppShellBrand, SumiNavItem } from 'sumi-ui/layout';

import { ApiService } from './api.service';

@Component({
  selector: 'app-root',
  imports: [...SUMI_LAYOUT, SumiHotkeyHelp, RouterOutlet, DecimalPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  readonly api = inject(ApiService);

  protected readonly brand: SumiAppShellBrand = { glyph: 'ア', name: 'Katakana Trainer' };

  protected readonly navItems: SumiNavItem[] = [
    { label: 'Practice', link: 'practice', icon: 'practice' },
    { label: 'Stats', link: 'stats', icon: 'stats' },
    { label: 'Dictionaries', link: 'dictionaries', icon: 'dictionary' },
    { label: 'Settings', link: 'settings', icon: 'settings' },
  ];

  ngOnInit(): void {
    // Header badges need to be right on any entry route, including a deep
    // link that never touches practice or stats.
    this.api.loadProfile().subscribe();
  }
}
