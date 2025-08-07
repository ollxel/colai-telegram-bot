function updateOrderMenu(chatId, messageId, session) {
    const { enabled_networks, custom_networks } = session.settings;
    const { networks } = session.networkManager;

    if (enabled_networks.length < 1) {
        bot.editMessageText('*Нет включенных участников для сортировки.*\n\nВключите хотя бы одну сеть в меню "Участники".', {
             chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
             reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'back_settings' }]] }
        }).catch(()=>{});
        return;
    }

    const keyboard = enabled_networks.map((networkId, index) => {
        const networkName = networks[networkId]?.name || custom_networks[networkId]?.name;
        const upArrow = (index > 0) ? { text: '🔼', callback_data: `order_up_${index}` } : { text: ' ', callback_data: 'no_op' };
        const downArrow = (index < enabled_networks.length - 1) ? { text: '🔽', callback_data: `order_down_${index}` } : { text: ' ', callback_data: 'no_op' };
        
        // --- ВОССТАНОВЛЕННЫЕ КНОПКИ ---
        return [
            upArrow, 
            { text: networkName, callback_data: 'no_op' }, 
            downArrow,
            { text: '➕', callback_data: `order_add_${index}` }, // Кнопка "Дублировать"
            { text: '➖', callback_data: `order_remove_${index}` } // Кнопка "Удалить"
        ];
    });
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);

    const menuText = `*Измените порядок и количество реплик:*\n\n` +
                     `🔼/🔽 - изменить порядок\n` +
                     `➕ - дублировать нейросеть для еще одной реплики\n` +
                     `➖ - удалить реплику из списка`;

    bot.editMessageText(menuText, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}
