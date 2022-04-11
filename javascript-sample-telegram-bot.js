const ftBot = require('node-telegram-bot-api');
const Redis = require('ioredis');
const schedule = require('node-schedule');
const winston = require('winston');
const { MongoClient } = require('mongodb');

const authorization = require('./js-modules/authorization.js');
const orderManagement = require('./js-modules/order-management.js');
const misc = require('./js-modules/misc.js');

// Подключение Redis.
global.redis = new Redis({
    port: 6379,
    host: '127.0.0.1',
});

subRedis = new Redis({
    port: 6379,
    host: '127.0.0.1',
});

global.pubRedis = new Redis({
    port: 6379,
    host: '127.0.0.1',
});

// Подключение MongoDB.
global.mongo = new MongoClient(
    'url',
    { useUnifiedTopology: true }
);
mongo.connect().then(async () => {
    // Обновить список региональных ссылок и временных зон при запуске бота.
    await misc.updateRegionInfo();
    // Обновить информацию о точках и записать в Redis.
    await misc.updateDepotInfo();
    // Проверить, существуют ли заказы, закрытые с задержкой (закрыть их).
    await orderManagement.checkOnPendingDeliveries();
});

// Периодически обновлять списки заказов для всех авторизированых курьеров.
setInterval(() => {
    orderManagement.updateOrderList();
}, 2 * 60 * 1000);

// Настройки бота (токен, порт, тест или нет, сообщения дебага и т.д.).
global.botSettings = {};

// Обработать параметры бота.
function parseArgs() {
    let isTestBot = false;
    let debugMessagesEnabled = false;
    let port = 3728;

    for (const arg of process.argv.slice(2)) {
        if (arg === '-t') {
            isTestBot = true;
        } else if (arg === '--debug-messages') {
            debugMessagesEnabled = true;
        } else if (arg.startsWith('--port')) {
            try {
                const providedPort = Number(arg.split('=')[1]);
                port = providedPort;
            } catch (error) {
                logger.error(error);
            }
        }
    }

    // Настроить токен и имя бота.
    if (isTestBot) {
        botSettings.token = 'token';
        botSettings.botHandle = 'handle';
    } else {
        botSettings.token = 'token';
    }

    // Настроить получение дебаг-сообщений.
    botSettings.debugMessagesEnabled = debugMessagesEnabled;

    // Настроить порт сервера с MongoDB и алгоритмом оптимизации.
    botSettings.tspServerPort = port;
}

parseArgs();

// В Redis использовать 6-ю базу.
const redisDb = 5;
redis.select(redisDb);
subRedis.select(redisDb);
pubRedis.select(redisDb);

// Подписаться на получение курьеров, отправляющихся в путь, а также на
// удаление ключей (используется в периодической проверке на наличие
// актуальных координат курьера).
subRedis.subscribe('travelers-en-route', `__keyevent@${redisDb}__:expired`);

subRedis.on('message', (channel, message) => {
    logger.info(`Received "${message}" from ${channel}.`);

    if (channel === 'travelers-en-route') {
        // Если получили traveler_id курьера, отправляющегося в путь.
        orderManagement.travelerEnRoute(message);
    } else if (message.startsWith('traveler-location')) {
        // Если актуальные координаты курьера удалились из Redis (таймаут).
        const telegramId = Number(message.split(':')[1]);
        checkOnTravelerLocation(telegramId);

        //misc.sendDebugMessage(telegramId, 'Traveler location lost.');
    }
});

// Подключить Telegram бота.
global.bot = new ftBot(botSettings.token, { polling: true });

// Настроить логгер для сообщений и ошибок.
global.logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.errors({ stack: true, })
    ),
    transports: [
        new winston.transports.File({
            filename: 'ft-errors.log',
            level: 'error',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: () => {
                        return new Date().toLocaleString('en-US');
                    }
                }),
                winston.format.json(),
            ),
        }),
        new winston.transports.File({
            filename: 'ft-combined.log',
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: () => {
                        return new Date().toLocaleString('en-US');
                    }
                }),
                winston.format.simple(),
            ),
        }),
        new winston.transports.Console({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: () => {
                        return new Date().toLocaleString('en-US');
                    }
                }),
                winston.format.simple(),
            ),
        }),
    ],
});

// Хранит сообщения для массовой рассылки. Ключ — telegram_id автора сообщения,
// значение — текст (и фото, если есть). Отправка осуществляется после выбора
// региона/регионов через кнопки.
global.BroadcastPosts = {};

// Обьявить константы для алгоритмов работы с координатами курьера.
// Через сколько секунд удалится запись координат курьера.
global.travelerLocationLifetime = 3 * 60;
// Через сколько секунд проверить, появились ли коориданаты у курьера или нет.
global.travelerLocationTimeout = 5 * 60;

// Обновлять список региональных ссылок и временных зон в 4:20 утра (cron).
const jUpdateRegionAndDepotInfo = schedule.scheduleJob('20 4 * * *', async () => {
    await misc.updateRegionInfo();
    await misc.updateDepotInfo();
});

// Обработать фото от пользователя.
bot.on('photo', (msg) => {
    const telegramId = msg.from.id;
    const username = msg.from.username;
    const photo = msg.photo[msg.photo.length - 1]['file_id'];

    // Если у фото есть надпись.
    if (msg.caption) {
        const text = msg.caption;

        // Если пользователь — или Альберт, или Антон, и текст начинается с $,
        // то это рассылка, которую надо отправить.
        if (
            (telegramId === 353756033 || telegramId === 430266091)
            && text.match(/^\$/)
        ) {
            const actualText = text.replace(/^\$/, '');

            // Отправить фото и надпись всем курьерам, которые есть в базе.
            BroadcastPosts[telegramId] = { text: actualText, photo };
            // Вызвать клавиатуру для выбора региона (куда отправить).
            misc.broadcastSelectRegion(telegramId);
        }
    }
});
