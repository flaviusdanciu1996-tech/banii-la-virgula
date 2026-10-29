import { TrendingDown,
  Home, Plug, ShoppingCart, Bus, Fuel, HeartPulse, Smartphone, Shirt, Sofa, GraduationCap, Gift, Shield,
  Utensils, Wine, Dumbbell, PartyPopper, Repeat, ShoppingBag, PiggyBank, TrendingUp, LifeBuoy, Wallet, Truck,
  Sparkles, CirclePlus, Circle, Landmark, Banknote, LineChart, Bitcoin, Scroll, PieChart, Car, Trees, Package,
  FileText, CreditCard, HandCoins, Baby, Dog, Plane, Coffee, Cigarette, Gamepad2, Wrench, Book, Music, Pill,
  Scissors, Hammer, Briefcase, Tv, Bike, Droplets, Flame, Zap, Wifi, Receipt, Building2, Target, Mountain, CalendarClock, Inbox, Sparkle, Search, Bell, Gem, Heart, Users, Star, type LucideIcon,
} from 'lucide-react'

export const ICONS: Record<string, LucideIcon> = {
  heart: Heart, users: Users, star: Star,
  home: Home, plug: Plug, 'shopping-cart': ShoppingCart, bus: Bus, fuel: Fuel, 'heart-pulse': HeartPulse,
  smartphone: Smartphone, shirt: Shirt, sofa: Sofa, 'graduation-cap': GraduationCap, gift: Gift, shield: Shield,
  utensils: Utensils, wine: Wine, dumbbell: Dumbbell, 'party-popper': PartyPopper, repeat: Repeat,
  'shopping-bag': ShoppingBag, 'piggy-bank': PiggyBank, 'trending-up': TrendingUp, 'trending-down': TrendingDown, 'life-buoy': LifeBuoy,
  wallet: Wallet, truck: Truck, sparkles: Sparkles, 'circle-plus': CirclePlus, circle: Circle,
  landmark: Landmark, banknote: Banknote, 'line-chart': LineChart, bitcoin: Bitcoin, scroll: Scroll,
  'pie-chart': PieChart, car: Car, trees: Trees, package: Package, 'file-text': FileText,
  'credit-card': CreditCard, 'hand-coins': HandCoins, baby: Baby, dog: Dog, plane: Plane, coffee: Coffee,
  cigarette: Cigarette, gamepad: Gamepad2, wrench: Wrench, book: Book, music: Music, pill: Pill,
  scissors: Scissors, hammer: Hammer, briefcase: Briefcase, tv: Tv, bike: Bike, droplets: Droplets,
  flame: Flame, zap: Zap, wifi: Wifi, receipt: Receipt, building: Building2, target: Target, mountain: Mountain, 'calendar-clock': CalendarClock, inbox: Inbox, sparkle: Sparkle, search: Search, bell: Bell, gem: Gem,
}

export const ICON_CHOICES = Object.keys(ICONS)

export function Icon({ name, size = 18, ...rest }: { name: string; size?: number; strokeWidth?: number; color?: string }) {
  const C = ICONS[name] ?? Circle
  return <C size={size} {...rest} aria-hidden="true" />
}
