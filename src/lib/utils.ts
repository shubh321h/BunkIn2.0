import { CartLine, Coupon, OrderStatus } from './types';
export const money = (n: number) => '₹' + new Intl.NumberFormat('en-IN',{maximumFractionDigits: Number.isInteger(n) ? 0 : 2}).format(n);
export const linePrice = (line: CartLine) => (line.food.price + line.variant.price + line.addons.reduce((a,x)=>a+x.price,0))*line.quantity;
export function calculateTotals(lines: CartLine[], coupon?: Coupon, deliveryFee=35, taxRate=.05) {
 const subtotal = Math.round(lines.reduce((sum,line)=>sum+linePrice(line),0)*100)/100;
 const discount = coupon && subtotal>=coupon.minimum ? Math.min(coupon.maxDiscount,coupon.type==='fixed'?coupon.value:subtotal*coupon.value/100) : 0;
 const tax = Math.round((subtotal-discount)*taxRate*100)/100;
 const delivery = subtotal>0?deliveryFee:0;
 return {subtotal,discount,tax,delivery,total:Math.round((subtotal-discount+tax+delivery)*100)/100};
}
export const statusLabels: Record<OrderStatus,string> = {placed:'Order placed',accepted:'Accepted',preparing:'In the kitchen',ready:'Ready for pickup',picked_up:'Picked up',out_for_delivery:'On the way',delivered:'Delivered',cancelled:'Cancelled'};
export const timeline: OrderStatus[] = ['placed','accepted','preparing','ready','picked_up','out_for_delivery','delivered'];
export const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validPhone = (value: string) => /^[+]?[0-9\s-]{10,15}$/.test(value);
