import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit'
import './color-input.js'
import type { TknColorInput } from './color-input.js'
import type { ScaleSaveDetail } from './types.js'

const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]

export class PrimitiveScaleDialog extends LitElement {
	static properties = {
		open: { type: Boolean, reflect: true },
		error: { type: String },
		prefix: { type: String },
		values: { type: Array },
	}

	declare open: boolean
	declare error: string
	declare prefix: string
	declare values: string[]

	constructor() {
		super()
		this.open = false
		this.error = ''
		this.prefix = ''
		this.values = SCALE_STEPS.map(() => '')
	}

	updated(changedProperties: PropertyValues<this>) {
		if (!changedProperties.has('open')) return

		const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')
		if (this.open && dialog && !dialog.open) {
			this.error = ''
			this.prefix = ''
			this.values = SCALE_STEPS.map(() => '')
			dialog.showModal()
			requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>('#scale-prefix')?.focus())
		} else if (!this.open && dialog?.open) {
			dialog.close()
		}
	}

	_close() {
		this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
	}

	_setValue(index: number, value: string) {
		this.values = this.values.map((current, valueIndex) => valueIndex === index ? value : current)
		this.error = ''
	}

	_parseColor(value: string): { channels: number[]; alpha: number } | null {
		const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value)
		if (hexMatch) {
			const hex = hexMatch[1].length === 3
				? hexMatch[1].split('').map((channel) => channel + channel).join('')
				: hexMatch[1]
			return { channels: [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)), alpha: 1 }
		}

		const rgbaMatch = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i.exec(value)
		if (!rgbaMatch || rgbaMatch.slice(1, 4).some((channel) => Number(channel) > 255)) return null
		return { channels: rgbaMatch.slice(1, 4).map(Number), alpha: Number(rgbaMatch[4]) }
	}

	_generateIntermediateValues() {
		const first = this.values[0].trim()
		const last = this.values[this.values.length - 1].trim()
		const start = this._parseColor(first)
		const end = this._parseColor(last)

		if (!start || !end) {
			this.error = 'Enter valid hex or rgba colors for steps 50 and 900 first.'
			return
		}

		this.values = SCALE_STEPS.map((_step, index) => {
			const progress = index / (SCALE_STEPS.length - 1)
			const channels = start.channels.map((channel, channelIndex) => Math.round(channel + (end.channels[channelIndex] - channel) * progress))
			const alpha = start.alpha + (end.alpha - start.alpha) * progress
			return alpha === 1
				? `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
				: `rgba(${channels.join(', ')}, ${Number(alpha.toFixed(3))})`
		})
		this.error = ''
	}

	_submit(event: SubmitEvent) {
		event.preventDefault()
		const prefix = this.prefix.trim()
		const values = this.values.map((value) => value.trim())

		if (!/^[A-Za-z][A-Za-z0-9]*$/.test(prefix)) {
			this.error = 'Use a scale name with letters and numbers only, starting with a letter.'
			return
		}
		if (values.some((value) => !this._parseColor(value))) {
			this.error = 'Enter a valid hex or rgba color for every step.'
			return
		}

		this.dispatchEvent(new CustomEvent<ScaleSaveDetail>('save', {
			detail: { prefix, steps: SCALE_STEPS, values },
			bubbles: true,
			composed: true,
		}))
	}

	render() {
		return html`
			<dialog @cancel=${(event: Event) => { event.preventDefault(); this._close() }}>
				<form @submit=${this._submit}>
					<header>
						<div>
							<p class="eyebrow">Primitive scale</p>
							<h2>Add 10-step color scale</h2>
						</div>
						<button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
					</header>

					<label>
						<span>Scale name</span>
						<input id="scale-prefix" type="text" required placeholder="blue" .value=${this.prefix} @input=${(event: Event) => { this.prefix = (event.target as HTMLInputElement).value; this.error = '' }} />
					</label>

					<div class="scale-grid">
						${SCALE_STEPS.map((step, index) => html`
							<div class="scale-color-field">
								<span>${step}</span>
								<tkn-color-input
									required
									placeholder="#000000 or rgba(...)"
									.value=${this.values[index]}
									@input=${(event: Event) => this._setValue(index, (event.target as TknColorInput).value)}
								></tkn-color-input>
							</div>
						`)}
					</div>

					${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}

					<footer>
						<button class="generate" type="button" @click=${this._generateIntermediateValues}>Generate between</button>
						<button class="secondary" type="button" @click=${this._close}>Cancel</button>
						<button class="primary" type="submit">Add scale</button>
					</footer>
				</form>
			</dialog>
		`
	}

	static styles = css`
		:host { display: contents; }
		*, *::before, *::after { box-sizing: border-box; }
		dialog { width: min(620px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 0; overflow: auto; border: 1px solid #D0D5DD; border-radius: 16px; background: #FFFFFF; color: #101828; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28); }
		dialog::backdrop { background: rgba(15, 23, 42, 0.48); }
		form { display: grid; gap: 20px; width: 100%; padding: 24px; }
		header, footer { display: flex; align-items: center; }
		header { justify-content: space-between; }
		footer { justify-content: flex-end; gap: 10px; }
		.eyebrow { margin: 0 0 4px; color: #667085; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
		h2 { margin: 0; font-size: 1.25rem; }
		label { display: grid; gap: 7px; font-size: 13px; font-weight: 600; }
		input[type='text'] { width: 100%; min-height: 38px; min-width: 0; padding: 0 9px; border: 1px solid #D0D5DD; border-radius: 8px; color: #101828; font: inherit; }
		.scale-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
		.scale-color-field { display: grid; gap: 7px; min-width: 0; font-size: 13px; font-weight: 600; }
		button { min-height: 38px; padding: 8px 13px; border: 1px solid #D0D5DD; border-radius: 9px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
		.close-button { min-height: 32px; padding: 0 9px; border: 0; background: transparent; color: #667085; font-size: 22px; }
		.generate { margin-right: auto; background: #EFF6FF; border-color: #BFDBFE; color: #1D4ED8; }
		.secondary { background: #FFFFFF; color: #344054; }
		.primary { border-color: #2563EB; background: #2563EB; color: #FFFFFF; }
		.error { margin: -8px 0 0; color: #B42318; font-size: 12px; }
		@media (max-width: 520px) { .scale-grid { grid-template-columns: 1fr; } }
	`
}

customElements.define('primitive-scale-dialog', PrimitiveScaleDialog)

declare global {
	interface HTMLElementTagNameMap {
		'primitive-scale-dialog': PrimitiveScaleDialog
	}
}
