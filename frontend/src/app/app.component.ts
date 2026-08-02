import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ApiService } from './api.service';

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" routerLink="/practice">
          <span class="brand-kana kana-font">ア</span>
          <span class="brand-name">Katakana Trainer</span>
        </a>
        @if (api.profile(); as p) {
          <div class="profile">
            <span class="chip chip-level">Level {{ p.level }}</span>
            <span class="chip">{{ p.elo | number: '1.0-0' }} Elo</span>
            @if (p.streak > 1) {
              <span class="chip chip-streak">{{ p.streak }} streak</span>
            }
          </div>
        }
      </div>
      <nav class="tabs">
        <a routerLink="/practice" routerLinkActive="active">Practice</a>
        <a routerLink="/stats" routerLinkActive="active">Stats</a>
        <a routerLink="/dictionaries" routerLinkActive="active">Dictionaries</a>
        <a routerLink="/settings" routerLinkActive="active">Settings</a>
      </nav>
    </header>

    <main class="content">
      <router-outlet />
    </main>
  `,
  styles: [
    `
      .topbar {
        background: var(--surface);
        border-bottom: 1px solid var(--grid);
      }
      .topbar-inner {
        max-width: 860px;
        margin: 0 auto;
        padding: 14px 20px 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        color: inherit;
      }
      .brand-kana {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        background: var(--accent);
        color: var(--accent-ink);
        font-size: 20px;
        font-weight: 600;
      }
      .brand-name {
        font-weight: 650;
        font-size: 17px;
      }
      .profile {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .chip {
        border: 1px solid var(--grid);
        border-radius: 999px;
        padding: 3px 12px;
        font-size: 13px;
        color: var(--ink-2);
        background: var(--page);
      }
      .chip-level {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--accent-ink);
        font-weight: 600;
      }
      .chip-streak {
        color: var(--good-text);
        border-color: var(--good);
      }
      .tabs {
        max-width: 860px;
        margin: 0 auto;
        padding: 0 20px;
        display: flex;
        gap: 4px;
      }
      .tabs a {
        border-bottom: 2px solid transparent;
        padding: 8px 14px;
        font-size: 14px;
        color: var(--ink-2);
        text-decoration: none;
        cursor: pointer;
      }
      .tabs a.active {
        color: var(--ink);
        font-weight: 600;
        border-bottom-color: var(--accent);
      }
      .content {
        max-width: 860px;
        margin: 0 auto;
        padding: 24px 20px 64px;
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  readonly api = inject(ApiService);

  ngOnInit(): void {
    // Header chips need to be right on any entry route, including a deep
    // link that never touches practice or stats.
    this.api.loadProfile().subscribe();
  }
}
