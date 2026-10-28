import { config } from './config';
import { supabase } from './supabase';
import { Address, Analytics, CheckoutRequest, CheckoutResult, Coordinates, Coupon, Food, MenuCategory, Order, OrderStatus, OwnerRecord, Profile, Restaurant, StaffCredentials, StaffMember, StaffRole } from './types';
export class ServiceError extends Error { constructor(message: string, public status=0) { super(message);this.name='ServiceError'; } }
export async function request<T>(path:string, options:RequestInit={}):Promise<T> {
 if(!config.apiUrl) throw new ServiceError('BunkIn is not connected to its service. Please contact the restaurant.',503);
 const session=await supabase?.auth.getSession();
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
 try {
  const response=await fetch(config.apiUrl.replace(/\/$/,'')+path,{...options,headers:{'Content-Type':'application/json',...(session?.data.session?{Authorization:`Bearer ${session.data.session.access_token}`} : {}),...options.headers},signal:controller.signal});
  const body=await response.json().catch(()=>null);
  if(!response.ok) throw new ServiceError(body?.message || (response.status===401?'Please sign in to continue.':response.status===403?'You do not have permission to access this workspace.':'The service is unavailable. Please try again.'),response.status);
  return body as T;
 } catch(error) { if(error instanceof ServiceError) throw error;throw new ServiceError('Unable to connect. Check your internet connection and try again.'); } finally { clearTimeout(timeout); }
}
const post=<T>(path:string,body:unknown)=>request<T>(path,{method:'POST',body:JSON.stringify(body)});
const patch=<T>(path:string,body:unknown)=>request<T>(path,{method:'PATCH',body:JSON.stringify(body)});
export const api={
 menu:()=>request<Food[]>('/menu'),
 restaurant:()=>request<Restaurant>('/restaurant'),
 offers:()=>request<Coupon[]>('/offers'),
 orders:()=>request<Order[]>('/orders'),
 order:(id:string)=>request<Order>(`/orders/${encodeURIComponent(id)}`),
 checkout:(body:CheckoutRequest)=>post<CheckoutResult>('/checkout',body),
 cancelOrder:(id:string,reason:string)=>post<Order>(`/orders/${encodeURIComponent(id)}/cancel`,{reason}),
 review:(id:string,rating:number,comment:string)=>post<void>(`/orders/${encodeURIComponent(id)}/review`,{rating,comment}),
 profile:()=>request<Profile>('/me'),
 passwordChanged:()=>post<Profile>('/me/password-changed',{}),
 updateProfile:(data:Partial<Profile>)=>patch<Profile>('/me',data),
 addresses:()=>request<Address[]>('/me/addresses'),
 saveAddress:(address:Address)=>post<Address>('/me/addresses',address),
 notifications:()=>request<{id:string;title:string;body:string;read:boolean}[]>('/me/notifications'),
 support:(subject:string,message:string)=>post<{id:string}>('/support',{subject,message}),
 owner:{
  analytics:(period:string)=>request<Analytics>(`/owner/analytics?period=${encodeURIComponent(period)}`),
  orders:()=>request<Order[]>('/owner/orders'),
  updateOrder:(id:string,data:{status?:OrderStatus;reason?:string;preparationMinutes?:number;riderId?:string})=>patch<Order>(`/owner/orders/${encodeURIComponent(id)}`,data),
  riders:()=>request<{id:string;name:string;available:boolean}[]>('/owner/riders'),
  saveFood:(food:Food)=>post<Food>('/owner/menu',food),
  settings:(data:Partial<Restaurant>)=>patch<Restaurant>('/owner/restaurant',data),
  refund:(id:string,reason:string)=>post<Order>(`/owner/orders/${encodeURIComponent(id)}/refund`,{reason}),
  reconcile:(id:string)=>post<void>(`/owner/orders/${encodeURIComponent(id)}/cod-reconciliation`,{}),
  customers:()=>request<{id:string;name:string;email:string;orderCount:number}[]>('/owner/customers'),
  staff:()=>request<StaffMember[]>('/owner/staff'),
  createStaff:(data:{name:string;email:string;phone:string;role:StaffRole})=>post<StaffCredentials>('/owner/staff',data),
  updateStaff:(id:string,data:{active?:boolean;resetPassword?:boolean})=>patch<StaffCredentials>(`/owner/staff/${encodeURIComponent(id)}`,data),
  report:(period:string)=>request<{csv:string}>(`/owner/reports?period=${period}`),
  coupons:()=>request<Coupon[]>('/owner/coupons'),
  saveCoupon:(coupon:Omit<Coupon,'title'|'description'>)=>post<Coupon>('/owner/coupons',coupon),
  categories:()=>request<MenuCategory[]>('/owner/categories'),
  saveCategory:(category:MenuCategory)=>post<MenuCategory>('/owner/categories',category),
  records:(section:string)=>request<OwnerRecord[]>(`/owner/${encodeURIComponent(section.toLowerCase().replace(' ','-'))}`),
  respond:(section:string,id:string,message:string)=>post<void>(`/owner/${encodeURIComponent(section.toLowerCase())}/${encodeURIComponent(id)}/response`,{message}),
 },
 rider:{
  assignments:()=>request<Order[]>('/rider/assignments'),
  history:()=>request<Order[]>('/rider/history'),
  update:(id:string,status: string,otp?:string)=>patch<Order>(`/rider/assignments/${id}`,{status,otp}),
  location:(id:string,location:Coordinates)=>post<void>(`/rider/assignments/${id}/location`,{...location,timestamp:new Date().toISOString()}),
  failed:(id:string,reason:string)=>post<void>(`/rider/assignments/${id}/failed`,{reason}),
 }
};
