import {useCallback,useEffect,useState} from 'react';
import { api } from '../lib/api';
import { Order } from '../lib/types';
import { messageOf } from '../lib/utils';
export function useOrders(scope:'customer'|'owner'|'rider'|'history'='customer'){
 const [orders,setOrders]=useState<Order[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const refresh=useCallback(async()=>{setLoading(true);setError('');try{setOrders(await (scope==='owner'?api.owner.orders():scope==='rider'?api.rider.assignments():scope==='history'?api.rider.history():api.orders()));}catch(e){setError(messageOf(e));}finally{setLoading(false);}},[scope]);useEffect(()=>{refresh();},[refresh]);return {orders,loading,error,refresh};
}
