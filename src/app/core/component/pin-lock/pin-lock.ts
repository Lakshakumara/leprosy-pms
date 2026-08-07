import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputOtpModule } from 'primeng/inputotp';
import { ButtonModule } from 'primeng/button';
import { CryptoService } from '../../services/crypto.service';

@Component({
  selector: 'app-pin-lock',
  standalone: true,
  imports: [FormsModule, InputOtpModule, ButtonModule],
  template: `
  <div class="pin-wrapper">
    <div class="pin-card">
      <i class="pi pi-lock" style="font-size: 2.5rem; color: var(--p-primary-color)"></i>
      <h2>{{ isFirstTime() ? 'Create PIN' : 'Enter PIN' }}</h2>
      <p>{{ isFirstTime() ? 'Set 4-digit PIN to protect patient data' : 'Patient data is encrypted' }}</p>
      
      <p-inputOtp [(ngModel)]="pin" [length]="4" [mask]="true" [integerOnly]="true" style="justify-content:center" />
      
      @if (isFirstTime()) {
        <p-inputOtp [(ngModel)]="confirmPin" [length]="4" [mask]="true" [integerOnly]="true" placeholder="Confirm" style="justify-content:center; margin-top:0.5rem" />
      }

      @if (error()) {
        <small class="p-error">{{ error() }}</small>
      }

      <button pButton [label]="isFirstTime() ? 'Create & Unlock' : 'Unlock'" 
        [disabled]="pin.length !== 4" 
        (click)="unlock()" 
        style="width:100%; margin-top:1rem"></button>
    </div>
  </div>
  `,
  styles: [`
    .pin-wrapper { height: 100vh; display:flex; align-items:center; justify-content:center; background: var(--p-surface-100) }
    .pin-card { background: white; padding: 2rem; border-radius: 1rem; width: 90%; max-width: 360px; text-align:center; display:flex; flex-direction:column; gap:1rem; box-shadow: 0 10px 30px rgba(0,0,0,0.1) }
    .p-error { color: var(--p-red-500) }
  `]
})
export class PinLockComponent {
  private crypto = inject(CryptoService);
  private router = inject(Router);

  pin = '';
  confirmPin = '';
  error = signal('');
  isFirstTime = signal(!localStorage.getItem('leprosy-pin-hash'));

  async unlock() {
    this.error.set('');
    if (this.isFirstTime()) {
      if (this.pin !== this.confirmPin) {
        this.error.set('PINs do not match');
        return;
      }
      await this.crypto.setPin(this.pin);
      this.router.navigate(['/']);
    } else {
      const ok = await this.crypto.verifyPin(this.pin);
      if (!ok) {
        this.error.set('Wrong PIN');
        return;
      }
      await this.crypto.deriveKeyFromPin(this.pin);
      this.router.navigate(['/']);
    }
  }
}