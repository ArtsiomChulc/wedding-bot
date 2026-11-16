import { Telegraf, Markup, session } from 'telegraf';
import { message } from 'telegraf/filters';
import * as dotenv from 'dotenv';
import * as http from 'http';

dotenv.config();

interface SessionData {
    step?: 'id' | 'names' | 'isPlural';
    newGuest: {
        id?: string;
        names?: string;
        isPlural?: string;
    };
}

const bot = new Telegraf<any>(process.env.BOT_TOKEN!);
const STEIN_URL = process.env.STEIN_URL!;
const SITE_URL = process.env.SITE_URL!;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').map(Number);

bot.use(session({ defaultSession: (): SessionData => ({ newGuest: {} }) }));

bot.use((ctx, next) => {
    if (ctx.from && ALLOWED_USERS.includes(ctx.from.id)) {
        return next();
    }
    return ctx.reply('У вас нет прав для управления этим ботом.');
});

const mainMenu = Markup.keyboard([
    ['➕ Добавить гостя', '📋 Список и ссылки'],
    ['📊 Статистика ответов (RSVP)']
]).resize();

bot.start((ctx) => {
    ctx.reply('Добро пожаловать в панель управления свадьбой! Выберите действие:', mainMenu);
});

bot.hears('📊 Статистика ответов (RSVP)', async (ctx) => {
    try {
        const res = await fetch(`${STEIN_URL}/responses`);
        const data: any[] = await res.json();

        if (!data.length) return ctx.reply('Пока никто не заполнил анкету.');

        const yesCount = data.filter((r) => r.attending?.includes('Придет')).length;
        const noCount = data.filter((r) => r.attending?.includes('Не придет')).length;
        const transferCount = data.filter((r) => r.transport?.includes('Нужен')).length;

        let report = `📊 *Сводка по ответам:*\n\n`;
        report += `✅ Придут: ${yesCount}\n`;
        report += `❌ Не смогут: ${noCount}\n`;
        report += `🚌 Нужен трансфер: ${transferCount}\n\n`;
        report += `*Детали по гостям:*\n`;

        data.forEach((r) => {
            report += `• *${r.name}*: ${r.attending} (${r.alcohol || 'без алк.'} -- трансфер ${r.transport})\n\n`;
        });

        await ctx.reply(report, {parse_mode: 'Markdown'});
    } catch {
        await ctx.reply('Ошибка при получении статистики.');
    }
});

bot.hears('📋 Список и ссылки', async (ctx) => {
    try {
        const res = await fetch(`${STEIN_URL}/guests`);
        const guests: any[] = await res.json();

        if (!guests.length) return ctx.reply('Список гостей пока пуст.');

        let messageText = `📋 *Список приглашенных:*\n\n`;
        guests.forEach((g) => {
            messageText += `👤 *${g.names}*\n🔗 \`${SITE_URL}/?id=${g.id}\`\n\n`;
        });

        await ctx.reply(messageText, {parse_mode: 'Markdown'});
    } catch {
        await ctx.reply('Ошибка при загрузке списка гостей.');
    }
});

bot.hears('➕ Добавить гостя', (ctx) => {
    ctx.session.step = 'id';
    ctx.session.newGuest = {};
    ctx.reply('Введите уникальный ID для ссылки (латиницей, без пробелов, например: `ivan` или `15`):', {
        parse_mode: 'Markdown',
        ...Markup.removeKeyboard()
    });
});

bot.on(message('text'), async (ctx) => {
    const step = ctx.session.step;
    if (!step) return;

    const text = ctx.message.text.trim();

    if (step === 'id') {
        ctx.session.newGuest.id = text.toLowerCase();
        ctx.session.step = 'names';
        return ctx.reply('Теперь введите обращение для сайта (например: *Дорогой Иван* или *Миша и Аня*):', {
            parse_mode: 'Markdown'
        });
    }

    if (step === 'names') {
        ctx.session.newGuest.names = text;
        ctx.session.step = 'isPlural';
        return ctx.reply(
            'Обращение на «Вы» / множественное число?',
            Markup.keyboard([['Да (Вы / Вас)', 'Нет (Ты / Тебя)']]).oneTime().resize()
        );
    }

    if (step === 'isPlural') {
        const isPlural = text.startsWith('Да') ? 'TRUE' : 'FALSE';
        const generatedLink = `${SITE_URL}/?id=${ctx.session.newGuest.id}`;
        const guestData = {
            id: ctx.session.newGuest.id,
            names: ctx.session.newGuest.names,
            isPlural: isPlural,
            telegramName: ctx.session.newGuest.names,
            links: generatedLink
        };

        try {
            const response = await fetch(`${STEIN_URL}/guests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([guestData])
            });

            if (response.ok) {
                const link = `${SITE_URL}/?id=${guestData.id}`;
                await ctx.reply(
                    `✅ Гость *${guestData.names}* успешно добавлен!\n\nПерсональная ссылка (нажмите, чтобы скопировать):\n\`${link}\``,
                    {
                        parse_mode: 'Markdown',
                        ...mainMenu
                    }
                );
            } else {
                await ctx.reply('Ошибка при сохранении в таблицу.', mainMenu);
            }
        } catch {
            await ctx.reply('Ошибка соединения со Stein API.', mainMenu);
        }

        ctx.session.step = undefined;
    }
});

bot.launch();
console.log('Свадебный бот запущен!');


const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Wedding bot is running!');
}).listen(PORT, () => {
    console.log(`HTTP сервер слушает порт ${PORT}`);
});