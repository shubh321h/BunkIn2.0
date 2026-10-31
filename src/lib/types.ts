export type Role = 'customer' | 'owner' | 'manager' | 'rider';
export type StaffRole = 'manager' | 'rider';
export interface StaffMember { id: string; name: string; email: string; phone: string; role: StaffRole; active: boolean; mustChangePassword: boolean }
export interface StaffCredentials { member: StaffMember; temporaryPassword?: string }
export interface MenuCategory { id: string; name: string; image?: string }
export interface OwnerRecord { id: string; name?: string; title?: string; number?: string; email?: string; message?: string; status?: string; orderCount?: number; total?: number; createdAt?: string }
export type Category = 'All' | 'Burgers' | 'Pizza' | 'Biryani' | 'Pasta' | 'Sides' | 'Desserts' | 'Beverages';
export interface Option { id: string; name: string; price: number }
export interface Food { id: string; name: string; category: Category; description: string; price: number; originalPrice?: number; stock?: number; image: string; veg: boolean; available: boolean; rating: number; reviews: number; tag?: string; calories: number; prep: string; variants: Option[]; addons: Option[] }
export interface CartLine { key: string; food: Food; quantity: number; variant: Option; addons: Option[]; spice: string; instructions: string }
export interface Coordinates { lat: number; lng: number }
export interface Address { id: string; label: string; line: string; area: string; contact: string; phone: string; location: Coordinates }
export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'picked_up' | 'out_for_delivery' | 'delivered' | 'cancelled';
export interface Order { id: string; number: string; createdAt: string; status: OrderStatus; deliveryStatus?: 'assigned' | 'arriving_at_pickup' | 'picked_up' | 'out_for_delivery' | 'delivered'; items: { foodId?: string; name: string; quantity: number; price: number; variant?: string; addons?: string[]; spice?: string; instructions?: string }[]; total: number; payment: 'cod' | 'online'; paymentStatus: 'pending' | 'paid' | 'refund_pending' | 'refunded'; address: Address; instructions: string; rider?: { id: string; name: string; phone?: string; location?: Coordinates; updatedAt?: string }; estimatedArrival?: string; deliveryOtp?: string; ownerDelivery?: boolean; subtotal?: number; discount?: number; tax?: number; deliveryFee?: number; couponCode?: string; cancelReason?: string; preparationMinutes?: number }
export interface Profile { id: string; name: string; email: string; phone: string; role: Role; mustChangePassword?: boolean }
export interface Restaurant { name: string; open: boolean; location: Coordinates; phone: string; deliveryFee: number; taxRate: number; minimumOrder: number; preparationMinutes: number; hours?: string; holidays?: string; radius?: number; address?: string; brandingImage?: string }
export interface Coupon { code: string; title: string; description: string; minimum: number; type: 'fixed' | 'percentage'; value: number; maxDiscount: number }
export interface CheckoutRequest { items: { foodId: string; quantity: number; variantId: string; addonIds: string[]; spice: string; instructions: string }[]; address: Address; coupon?: string; payment: 'cod' | 'online'; instructions: string; idempotencyKey: string }
export interface CheckoutResult { order: Order; paymentUrl?: string }
export interface Analytics { orders: number; grossSales: number; discounts: number; taxes: number; deliveryCharges: number; refunds: number; netRevenue: number; pending: number; completed: number; daily: number[] }
