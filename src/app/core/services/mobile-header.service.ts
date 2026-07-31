// mobile-header.service.ts

import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

export interface MobileAction {
  icon: string;
  label: string;
  command: () => void;
  disabled?: boolean;
  tooltip?: string;
  badge?: string | number;
  visible?: boolean;
  severity?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

export interface MobileOverflow {
  label: string;
  icon?: string;
  command: () => void;
  disabled?: boolean;
  visible?: boolean;
  separator?: boolean;
  badge?: string | number;
}

export interface MobileHeaderConfig {
  title: string;
  subtitle?: string;
  count?: string;
  backRoute?: string | string[];
  backCallback?: () => void;
  actions?: MobileAction[];
  overflow?: MobileOverflow[];
  showSearch?: boolean;
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  showMenu?: boolean;
  menuCommand?: () => void;
  loading?: boolean;
  showInfo?: boolean;
}

const DEFAULT_CONFIG: MobileHeaderConfig = {
  title: 'Leprosy PMS',
  showInfo: true,
  actions: [],
  overflow: []
};

@Injectable({ providedIn: 'root' })
export class MobileHeaderService {
  private router = inject(Router);

  // Private signal store
  private readonly _config = signal<MobileHeaderConfig>(DEFAULT_CONFIG);

  // Readonly signal for components
  readonly config = this._config.asReadonly();

  // Derived Computed Values
  readonly hasBack = computed(() => !!(this._config().backRoute || this._config().backCallback));
  readonly hasActions = computed(() => (this._config().actions?.length ?? 0) > 0);
  readonly hasOverflow = computed(() => (this._config().overflow?.length ?? 0) > 0);
  
  readonly visibleActions = computed(() => 
    (this._config().actions || []).filter(a => a.visible !== false)
  );

  readonly visibleOverflow = computed(() => 
    (this._config().overflow || []).filter(o => o.visible !== false)
  );

  readonly isLoading = computed(() => this._config().loading === true);
  readonly showSearch = computed(() => this._config().showSearch === true);
  readonly showMenu = computed(() => this._config().showMenu === true);
  readonly shouldShowInfo = computed(() => this._config().showInfo !== false);

  /**
   * Set complete configuration
   */
  set(cfg: MobileHeaderConfig): void {
    this._config.set({
      ...DEFAULT_CONFIG,
      ...cfg
    });
  }

  /**
   * Reset to default state
   */
  clear(): void {
    this._config.set(DEFAULT_CONFIG);
  }

  /**
   * Merge partial updates safely
   */
  update(partial: Partial<MobileHeaderConfig>): void {
    this._config.update(current => ({ ...current, ...partial }));
  }

  // --- Convenience Modifiers ---

  setTitle(title: string): void { this.update({ title }); }
  setSubtitle(subtitle: string): void { this.update({ subtitle }); }
  setCount(count: string): void { this.update({ count }); }
  setLoading(loading: boolean): void { this.update({ loading }); }

  setBack(route: string | string[] | (() => void)): void {
    if (typeof route === 'function') {
      this.update({ backCallback: route, backRoute: undefined });
    } else {
      this.update({ backRoute: route, backCallback: undefined });
    }
  }

  // --- Immutable Action / Overflow Handlers ---

  addAction(action: MobileAction): void {
    this._config.update(cfg => ({
      ...cfg,
      actions: [...(cfg.actions || []), action]
    }));
  }

  addActions(actions: MobileAction[]): void {
    this._config.update(cfg => ({
      ...cfg,
      actions: [...(cfg.actions || []), ...actions]
    }));
  }

  removeAction(label: string): void {
    this._config.update(cfg => ({
      ...cfg,
      actions: (cfg.actions || []).filter(a => a.label !== label)
    }));
  }

  clearActions(): void {
    this.update({ actions: [] });
  }

  addOverflow(item: MobileOverflow): void {
    this._config.update(cfg => ({
      ...cfg,
      overflow: [...(cfg.overflow || []), item]
    }));
  }

  addOverflowItems(items: MobileOverflow[]): void {
    this._config.update(cfg => ({
      ...cfg,
      overflow: [...(cfg.overflow || []), ...items]
    }));
  }

  removeOverflow(label: string): void {
    this._config.update(cfg => ({
      ...cfg,
      overflow: (cfg.overflow || []).filter(o => o.label !== label)
    }));
  }

  clearOverflow(): void {
    this.update({ overflow: [] });
  }

  // --- Search & Navigation ---

  enableSearch(placeholder = 'Search...', onSearch?: (query: string) => void): void {
    this.update({ showSearch: true, searchPlaceholder: placeholder, onSearch });
  }

  disableSearch(): void {
    this.update({ showSearch: false, searchPlaceholder: undefined, onSearch: undefined });
  }

  enableMenu(command: () => void): void {
    this.update({ showMenu: true, menuCommand: command });
  }

  disableMenu(): void {
    this.update({ showMenu: false, menuCommand: undefined });
  }

  goBack(): void {
    const cfg = this._config();
    if (cfg.backCallback) {
      cfg.backCallback();
      return;
    }
    if (cfg.backRoute) {
      if (Array.isArray(cfg.backRoute)) {
        this.router.navigate(cfg.backRoute);
      } else {
        this.router.navigateByUrl(cfg.backRoute);
      }
      return;
    }
    window.history.back();
  }
}