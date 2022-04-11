const Koa = require('koa');
const Router = require('koa-router');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const { MongoClient, ObjectId } = require('mongodb');

const app = new Koa();

// CORS.
app.use((ctx, next) => {
    ctx.set('Access-Control-Allow-Credentials', 'true');
    ctx.set('Access-Control-Allow-Origin', '*');

    return next()
});

app.use(cors());
app.use(bodyParser());

const router = new Router();

// Подключение к MongoDB.
global.mongo = new MongoClient(
    'url',
    { useUnifiedTopology: true }
);
mongo.connect();

// Получить список вечеринок.
async function retrievePartyList(page = 1, partiesPerPage = 5) {
    // Получить список вечеринок с учетом перелистывания
    // (страница/кол-во на страницу).
    const cursor = mongo.db('PartyPlanner').collection('parties')
        .find({}, { 'limit': partiesPerPage, 'skip': (page - 1) * partiesPerPage })
        .sort({ '_id': -1 });

    // Получить результат запроса.
    const parties = [];
    await cursor.forEach((party) => {
        parties.push(party);
    });

    return parties;
}

// GET-запрос на список вечеринок.
router.get('/parties', async (ctx) => {
    const { query } = ctx.request;

    try {
        let page = 1;
        let partiesPerPage = 5;

        // Обработать доп. параметры (если есть).
        if ('page' in query) page = Number(query['page']);
        if ('parties_per_page' in query) partiesPerPage = Number(query['parties_per_page']);

        // Вернуть код "успешно" и список вечеринок.
        ctx.code = 200;
        ctx.body = await retrievePartyList(page, partiesPerPage);

        console.log('Successfully returned party list.');
    } catch (error) {
        // Вернуть код внутренней ошибки.
        ctx.code = 500;
    }
});

// POST-запрос на добавление новой вечиринки.
router.post('/parties', async (ctx) => {
    const { body } = ctx.request;

    try {
        // Создать обьект новой вечиринки на основе предоставленных данных.
        const newParty = {
            'name': body['new_party']['name'],
            'host': body['new_party']['host'],
            'address': body['new_party']['address'],
            'date': new Date(body['new_party']['date']),
        };

        // Добавить в базу.
        await mongo.db('PartyPlanner').collection('parties')
            .insertOne(newParty);

        // Вернуть обновленный список заказов.
        let page = 1;
        let partiesPerPage = 5;

        if ('page' in body) page = Number(body['page']);
        if ('parties_per_page' in body) partiesPerPage = Number(body['parties_per_page']);

        // Вернуть код "успешно создан" и список вечеринок.
        ctx.status = 201;
        ctx.body = await retrievePartyList(page, partiesPerPage);

        console.log('Successfully created party.');
    } catch (error) {
        // Вернуть код внутренней ошибки.
        ctx.status = 500;
    }
});

// DELETE-запрос на удаление вечеринки.
router.delete('/parties/:id', async (ctx) => {
    const { params } = ctx;

    try {
        // Удалить из базы.
        const response = await mongo.db('PartyPlanner').collection('parties')
            .deleteOne({ '_id': ObjectId(params['id']) });

        if (response.deletedCount === 0) {
            // Если в базе ничего не изменилось, вернуть код
            // ошибки "не найдено".
            ctx.status = 404;

            console.log('Failed to cancel nonexisting party.');
        } else {
            // Вернуть код "успешно" без дополнительного контента.
            ctx.status = 204;

            console.log('Successfully canceled party.');
        }
    } catch (error) {
        // Вернуть код внутренней ошибки.
        ctx.status = 500;
    }
});

app
    .use(router.routes())
    .use(router.allowedMethods());

app.listen(1226);
