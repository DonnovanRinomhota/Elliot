# Elliot brand kit

The Elliot logo: a gold house whose inner lines form an **E**, the **ELLIOT**
wordmark (Jost, converted to outlines, so no font is needed) and the line
**CONNECT • QUALIFY • BOOK**. Drawn as vectors from the logo chosen in
November 2026.

## Which file for what

| Use | File |
|---|---|
| Website / dashboard header (light background) | `svg/elliot-logo-horizontal-navy.svg` |
| Header on a dark background | `svg/elliot-logo-horizontal-gold.svg` or `-white.svg` |
| Full logo with tagline (presentations, documents, social) | `svg/elliot-logo-stacked-dark.svg`, `png/elliot-logo-stacked-dark-2400.png` |
| Full logo on white | `svg/elliot-logo-stacked-navy.svg`, `png/elliot-logo-stacked-navy-2400.png` |
| Full logo, transparent, gold | `png/elliot-logo-stacked-gold-transparent-2400.png` |
| Mark alone | `svg/elliot-mark.svg` (gold), `-navy`, `-white`, `-gold-flat` |
| WhatsApp / Facebook / LinkedIn profile picture | `png/elliot-profile-square-640.png` (the apps crop it to a circle) |
| App icon | `png/elliot-app-icon-1024.png`, `-512.png` |
| Favicons | `svg/elliot-favicon.svg`, `png/favicon.ico`, `png/favicon-32.png`, `png/apple-touch-icon-180.png`, `png/icon-192.png` |
| Link preview image (Open Graph) | `png/elliot-social-1200x630.png` |

In code: `apps/elliot-dashboard/app/_ui/elliot-logo.tsx` (`ElliotMark`,
`ElliotWordmark`, `ElliotLogo`); the website has the same component in
`components/Logo.tsx`.

## Colours

| Name | Hex |
|---|---|
| Gold, light | `#F3D4A4` |
| Gold | `#D9A56C` |
| Gold, deep | `#B97E47` |
| Gold, flat (one-colour use) | `#C9935A` |
| Navy | `#0F172A` |
| Night (dark backgrounds) | `#0B1222` → `#060A14` |

The gold is a gradient from light (top left) to deep and back to a
highlight (bottom right). On light backgrounds keep the wordmark navy and
let the mark carry the gold; gold text on white is too faint to read.

## Rules
- Leave space around the logo of at least the height of the E's bottom bar ×2.
- Smallest sizes: mark 16 px (favicon), horizontal logo 90 px wide.
- Don't stretch, rotate, recolour the gold, or add shadows.
