import { Category } from './types';
export const images: Record<string, any> = {
 hero: require('../../assets/images/hero.jpg'), burger: require('../../assets/images/burger.jpg'), pizza: require('../../assets/images/pizza.jpg'), biryani: require('../../assets/images/biryani.jpg'), pasta: require('../../assets/images/pasta.jpg'), dessert: require('../../assets/images/dessert.jpg'), drink: require('../../assets/images/drink.jpg'), fries: require('../../assets/images/fries.jpg'), salad: require('../../assets/images/salad.jpg'), wrap: require('../../assets/images/wrap.jpg'), avatar: require('../../assets/images/avatar.jpg'),
};
export const categories: {name: Category; image: string}[] = [{name:'Burgers',image:'burger'},{name:'Pizza',image:'pizza'},{name:'Biryani',image:'biryani'},{name:'Pasta',image:'pasta'},{name:'Sides',image:'fries'},{name:'Desserts',image:'dessert'},{name:'Beverages',image:'drink'}];
