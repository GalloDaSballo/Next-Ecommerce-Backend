'use strict';
const { sanitizeEntity } = require('strapi-utils');

const stripe = require('stripe')(process.env.STRIPE_PK)

/**
 * Given a dollar amount number, convert it to it's value in cents
 * @param number 
 */
const fromDecimalToInt = (number) => parseInt(number * 100)


/**
 * Read the documentation (https://strapi.io/documentation/v3.x/concepts/controllers.html#core-controllers)
 * to customize this controller
 */

module.exports = {
    /**
     * Only send back orders from you
     * @param {*} ctx 
     */
    async find(ctx) {
        const { user } = ctx.state
        let entities;
        if (ctx.query._q) {
            entities = await strapi.services.order.search({...ctx.query, user: user.id});
        } else {
            entities = await strapi.services.order.find({...ctx.query, user: user.id});
        }

        return entities.map(entity => sanitizeEntity(entity, { model: strapi.models.order }));
    },
    /**
     * Retrieve an order by id, only if it belongs to the user
     */
    async findOne(ctx) {
        const { id } = ctx.params;
        const { user } = ctx.state

        const entity = await strapi.services.order.findOne({ id, user: user.id });
        return sanitizeEntity(entity, { model: strapi.models.order });
    },


    async create(ctx) {
        const BASE_URL = ctx.request.headers.origin || 'http://localhost:3000' //So we can redirect back
    
        const { product } = ctx.request.body
        if(!product){
            return res.status(400).send({error: "Please add a product to body"})
        }

        //Retrieve the real product here
        const realProduct = await strapi.services.product.findOne({ id: product.id })
        if(!realProduct){
            return res.status(404).send({error: "This product doesn't exist"})
        }

        const {user} = ctx.state //From Magic Plugin

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: realProduct.name
                        },
                        unit_amount: fromDecimalToInt(realProduct.price),
                    },
                    quantity: 1,
                },
            ],
            customer_email: user.email, //Automatically added by Magic Link
            mode: "payment",
            success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: BASE_URL,
        })
        
        //TODO Create Temp Order here
        const newOrder = await strapi.services.order.create({
            user: user.id,
            product: realProduct.id,
            total: realProduct.price,
            status: 'unpaid',
            checkout_session: session.id
        })

        return { id: session.id }
    },
    async confirm(ctx) {
        const { checkout_session } = ctx.request.body
        console.log("checkout_session", checkout_session)
        const session = await stripe.checkout.sessions.retrieve(
            checkout_session
        )
        console.log("verify session", session)

        if(session.payment_status === "paid"){
            //Update order
            const newOrder = await strapi.services.order.update({
                checkout_session
            },
            {
                status: 'paid'
            })

            return newOrder
    
        } else {
            ctx.throw(400, "It seems like the order wasn't verified, please contact support")
        }
    }
};
