import { Beer, Bike, CakeSlice, Coffee, Croissant, CupSoda, IceCreamCone, Pizza, Salad, ShoppingBag, Smartphone, Soup, UtensilsCrossed, type LucideIcon } from 'lucide-react'

export const ORDER_TYPES = [
  ['dine_in', 'Dine-in'],
  ['takeaway', 'Takeaway'],
  ['delivery', 'Delivery'],
  ['aggregator', 'Delivery app'],
] as const

// Colour and symbol together, so order types can be told apart without relying on colour alone.
export const TYPE_LOOK: Record<string, { icon: LucideIcon; tone: string; soft: string }> = {
  dine_in: { icon: UtensilsCrossed, tone: 'border-brand/40 bg-brand-tint text-brand-deep', soft: 'text-brand-deep' },
  takeaway: { icon: ShoppingBag, tone: 'border-wait/40 bg-wait-tint text-wait', soft: 'text-wait' },
  delivery: { icon: Bike, tone: 'border-sky/40 bg-sky-tint text-sky', soft: 'text-sky' },
  aggregator: { icon: Smartphone, tone: 'border-ok/40 bg-ok-tint text-ok', soft: 'text-ok' },
}

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed, coffee: Coffee, cup: CupSoda, cake: CakeSlice, croissant: Croissant,
  pizza: Pizza, salad: Salad, soup: Soup, ice_cream: IceCreamCone, beer: Beer,
}

export const CATEGORY_ICON_NAMES: Record<string, string> = {
  utensils: 'Plate', coffee: 'Coffee', cup: 'Drink', cake: 'Cake', croissant: 'Bakery',
  pizza: 'Pizza', salad: 'Salad', soup: 'Soup', ice_cream: 'Ice cream', beer: 'Beer',
}

export const typeName = (type: string) => ORDER_TYPES.find(([value]) => value === type)?.[1] ?? type
