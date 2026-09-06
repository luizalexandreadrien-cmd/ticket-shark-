const http = require('http');

// Servidor Web para o Render reconhecer que a aplicação está ativa
http.createServer((req, res) => {
    res.write("Bot de Tickets Shark MM está 100% Online!");
    res.end();
}).listen(process.env.PORT || 3000);
require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ChannelType, 
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const APPRENTICE_ROLE_ID = process.env.APPRENTICE_ROLE_ID;
const EVAL_CHANNEL_ID = process.env.EVAL_CHANNEL_ID;

// ID do Canal de Transcripts/Logs de Ticket
const TRANSCRIPT_CHANNEL_ID = '1527443237596430557';

// IDs das Equipes
const SALES_TEAM_ROLE_ID = '1540134797001883759';
const SUPPORT_TEAM_ROLE_ID = '1534072144508616764';

// IDs das Categorias
const CATEGORY_SUPPORT_ID = process.env.CATEGORY_SUPPORT_ID;
const CATEGORY_SALES_ID = process.env.CATEGORY_SALES_ID;
const CATEGORY_PURCHASES_ID = process.env.CATEGORY_PURCHASES_ID;

// ID do Canal de Voz Fixo
const VOICE_CHANNEL_ID = '1531085180381696030';

// Banner Shark MM
const TICKET_BANNER_URL = 'https://media.discordapp.net/attachments/1545275181004627989/1545874222155431936/a17a2ea1-6d98-4772-afe6-7129adb48332.png?ex=6a9dbb0f&is=6a9c698f&hm=09bd41743fffccb7d0f6af0561ec64cbcfeb00b745f03e70eca7af0eb408e4b6&=&format=webp&quality=lossless&width=1024&height=576'; 

const activeTickets = new Map(); 
const userStats = new Map(); 

// Slash Commands
const commands = [
    new SlashCommandBuilder()
        .setName('setup-ticket')
        .setDescription('Envia o painel de criação de tickets no canal')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('fechar-ticket')
        .setDescription('Encerra o ticket atual')
].map(command => command.toJSON());

function connectToVoiceChannel() {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!channel) return console.log('❌ Canal de voz não foi encontrado no servidor.');

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
        console.log('⚠️ Conexão de voz perdida. Reconectando em 5 segundos...');
        setTimeout(connectToVoiceChannel, 5000);
    });

    console.log(`🔊 Bot conectado com sucesso ao canal de voz: ${channel.name}`);
}

async function generateTranscript(channel) {
    let messages = [];
    let lastId;

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;

        messages.push(...fetched.values());
        lastId = fetched.last().id;
    }

    messages.reverse();

    let transcriptText = `==================================================\n`;
    transcriptText += `TRANSCRIPT DO TICKET: #${channel.name}\n`;
    transcriptText += `GERADO EM: ${new Date().toLocaleString('pt-BR')}\n`;
    transcriptText += `==================================================\n\n`;

    for (const msg of messages) {
        const date = new Date(msg.createdTimestamp).toLocaleString('pt-BR');
        let content = msg.content || '[Sem texto / Apenas anexos ou embeds]';

        if (msg.attachments.size > 0) {
            const attUrls = msg.attachments.map(a => a.url).join(', ');
            content += ` [Anexos: ${attUrls}]`;
        }

        transcriptText += `[${date}] ${msg.author.tag} (${msg.author.id}): ${content}\n`;
    }

    const buffer = Buffer.from(transcriptText, 'utf-8');
    return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
}

client.once('ready', async () => {
    console.log(`🤖 Bot online como ${client.user.tag}!`);

    connectToVoiceChannel();

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('🔄 Registrando comandos Slash (/)...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Comandos Slash registrados com sucesso!');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
});

client.on('guildMemberRemove', async (member) => {
    for (const [channelId, data] of activeTickets.entries()) {
        if (data.userId === member.id) {
            const channel = member.guild.channels.cache.get(channelId);
            if (channel) {
                if (data.timeoutId) clearTimeout(data.timeoutId);
                await channel.delete().catch(() => {});
            }
            activeTickets.delete(channelId);
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (activeTickets.has(message.channel.id)) {
        const data = activeTickets.get(message.channel.id);
        if (message.author.id === data.userId) {
            if (data.timeoutId) clearTimeout(data.timeoutId);
            
            data.timeoutId = setTimeout(async () => {
                const channel = message.guild.channels.cache.get(message.channel.id);
                if (channel) {
                    await channel.send('⏳ Ticket fechado automaticamente por inatividade (10 minutos sem mensagens).');
                    setTimeout(() => channel.delete().catch(() => {}), 3000);
                }
                activeTickets.delete(message.channel.id);
            }, 10 * 60 * 1000);
        }
    }
});

client.on('interactionCreate', async (interaction) => {

    if (interaction.isChatInputCommand()) {
        
        if (interaction.commandName === 'setup-ticket') {
            const embedPanel = new EmbedBuilder()
                .setTitle('ABRA SEU TICKET')
                .setDescription('Os tickets do servidor foram criados para organizar as atividades da comunidade. Por meio deles, é possível abrir leilões, realizar vendas e compras de itens, tirar dúvidas com a equipe e registrar denúncias, garantindo negociações seguras, atendimento eficiente e a manutenção da ordem no servidor.')
                .setColor('#38B6FF')
                .setImage(TICKET_BANNER_URL);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_ticket')
                .setPlaceholder('Selecione o tipo de ticket')
                .addOptions([
                    { label: 'Ticket Vendas', description: 'Clique para vender seu item, envie uma foto e o valor.', value: 'vendas', emoji: '1540147182282477698' },
                    { label: 'Ticket Suporte', description: 'Clique para tirar dúvidas gerais ou solicitar ajuda.', value: 'suporte', emoji: '1540147489959575644' },
                    { label: 'Ticket Compras', description: 'Clique para comprar itens da loja.', value: 'compras', emoji: '1540147153706688642' },
                    { label: 'Ticket Denúncias', description: 'Informe qual usuário deseja denunciar e anexe as provas.', value: 'denuncias', emoji: '1540147235730366474' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.channel.send({ embeds: [embedPanel], components: [row] });
            return interaction.reply({ content: '✅ Painel de tickets enviado!', ephemeral: true });
        }

        if (interaction.commandName === 'fechar-ticket') {
            if (!activeTickets.has(interaction.channel.id)) {
                return interaction.reply({ content: '❌ Este canal não é um ticket ativo.', ephemeral: true });
            }

            const modal = new ModalBuilder()
                .setCustomId('modal_fechar_ticket')
                .setTitle('Fechar Ticket');

            const reasonInput = new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Motivo do fechamento do ticket')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            return interaction.showModal(modal);
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket') {
        const user = interaction.user;
        const guild = interaction.guild;

        const hasOpenTicket = Array.from(activeTickets.values()).some(t => t.userId === user.id);
        if (hasOpenTicket) {
            return interaction.reply({ content: '❌ Você já possui um ticket aberto! Feche o anterior para abrir outro.', ephemeral: true });
        }

        const option = interaction.values[0];
        const ticketId = Math.random().toString(36).substring(2, 8).toUpperCase();

        let targetCategory;
        let roleToMention;
        const isSalesOrPurchase = (option === 'vendas' || option === 'compras');

        if (isSalesOrPurchase) {
            targetCategory = option === 'vendas' ? CATEGORY_SALES_ID : CATEGORY_PURCHASES_ID;
            roleToMention = SALES_TEAM_ROLE_ID;
        } else {
            targetCategory = CATEGORY_SUPPORT_ID;
            roleToMention = SUPPORT_TEAM_ROLE_ID;
        }

        // Permissões padrão para os canais
        const permissionOverwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
            { id: STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
            { id: APPRENTICE_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
            { id: SUPPORT_TEAM_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
        ];

        // Se for ticket de Vendas ou Compras, dá permissão ao cargo de Vendas. Caso contrário, oculta.
        if (isSalesOrPurchase) {
            permissionOverwrites.push({
                id: SALES_TEAM_ROLE_ID,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
            });
        } else {
            permissionOverwrites.push({
                id: SALES_TEAM_ROLE_ID,
                deny: [PermissionFlagsBits.ViewChannel]
            });
        }

        const channel = await guild.channels.create({
            name: `ticket-${user.username}`,
            type: ChannelType.GuildText,
            parent: targetCategory,
            permissionOverwrites: permissionOverwrites
        });

        const timeoutId = setTimeout(async () => {
            const ch = guild.channels.cache.get(channel.id);
            if (ch) {
                await ch.send('⏳ Ticket fechado automaticamente por inatividade (10 minutos sem mensagens).');
                setTimeout(() => ch.delete().catch(() => {}), 3000);
            }
            activeTickets.delete(channel.id);
        }, 10 * 60 * 1000);

        activeTickets.set(channel.id, {
            userId: user.id,
            staffId: null,
            category: option,
            ticketId: ticketId,
            timeoutId: timeoutId
        });

        await interaction.reply({ content: `Seu ticket foi criado: ${channel}`, ephemeral: true });

        const ticketEmbed = new EmbedBuilder()
            .setTitle('ATENDIMENTO')
            .setDescription(`Olá, ${user}. Seja bem-vindo ao seu ticket.\nConverse diretamente com a equipe e forneça todas as informações necessárias para agilizar o atendimento.\n\nAguarde: um responsável responderá assim que estiver disponível.`)
            .addFields(
                { name: 'Categoria do Atendimento:', value: option.toUpperCase() },
                { name: 'ID do Ticket:', value: `\`${ticketId}\`` },
                { name: 'Responsável pelo Atendimento:', value: 'Equipe de atendimento' }
            )
            .setColor('#38B6FF')
            .setImage(TICKET_BANNER_URL);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('assumir_ticket').setLabel('Assumir Ticket').setStyle(ButtonStyle.Secondary).setEmoji('📌'),
            new ButtonBuilder().setCustomId('painel_admin').setLabel('Painel Admin').setStyle(ButtonStyle.Primary).setEmoji('1540147489959575644'),
            new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('1540147599435374662')
        );

        await channel.send({ content: `${user} | <@&${roleToMention}>`, embeds: [ticketEmbed], components: [buttons] });
    }

    if (interaction.isButton()) {
        const ticketData = activeTickets.get(interaction.channel.id);
        const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID) || 
                        interaction.member.roles.cache.has(APPRENTICE_ROLE_ID) ||
                        interaction.member.roles.cache.has(SALES_TEAM_ROLE_ID) ||
                        interaction.member.roles.cache.has(SUPPORT_TEAM_ROLE_ID);

        if (interaction.customId === 'assumir_ticket') {
            if (!isStaff) return interaction.reply({ content: '❌ Apenas a equipe de atendimento pode assumir tickets.', ephemeral: true });

            if (ticketData) ticketData.staffId = interaction.user.id;

            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .spliceFields(2, 1, { name: 'Responsável pelo Atendimento:', value: `${interaction.user}` });

            await interaction.message.edit({ embeds: [embed] });
            return interaction.reply({ content: `✅ Ticket assumido por ${interaction.user}!` });
        }

        if (interaction.customId === 'painel_admin') {
            if (!isStaff) return interaction.reply({ content: '❌ Apenas membros da equipe possuem permissão para acessar o Painel Admin.', ephemeral: true });

            const staffMention = ticketData?.staffId ? `<@${ticketData.staffId}>` : `${interaction.user}`;

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('notificar_membro').setLabel('Notificar Membro').setStyle(ButtonStyle.Primary).setEmoji('🔔'),
                new ButtonBuilder().setCustomId('adicionar_membro').setLabel('Adicionar Membro').setStyle(ButtonStyle.Secondary).setEmoji('1543289756484378795'),
                new ButtonBuilder().setCustomId('remover_membro').setLabel('Remover Membro').setStyle(ButtonStyle.Secondary).setEmoji('1543289832258674740')
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Finalizar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
            );

            return interaction.reply({
                content: `🛠️ **— Ações do Atendente**\n\nTicket assumido por ${staffMention}. Escolha uma ação:`,
                components: [row1, row2],
                ephemeral: true
            });
        }

        if (interaction.customId === 'notificar_membro') {
            if (!isStaff) return interaction.reply({ content: '❌ Apenas membros da equipe podem notificar o membro.', ephemeral: true });
            if (!ticketData) return interaction.reply({ content: '❌ Ticket não localizado.', ephemeral: true });

            const targetUser = await client.users.fetch(ticketData.userId).catch(() => null);

            if (!targetUser) {
                return interaction.reply({ content: '❌ Usuário do ticket não foi encontrado.', ephemeral: true });
            }

            try {
                await targetUser.send(`🔔 **Aviso sobre seu Ticket!**\n\nA equipe de atendimento está aguardando sua resposta no canal de ticket: ${interaction.channel}`);
                return interaction.reply({ content: `✅ Notificação enviada na DM de ${targetUser}!`, ephemeral: true });
            } catch (error) {
                await interaction.channel.send({ content: `<@${ticketData.userId}>, a equipe de atendimento está aguardando sua resposta neste ticket!` });
                return interaction.reply({ content: `⚠️ A DM de ${targetUser} está fechada, então a notificação foi enviada diretamente no canal do ticket.`, ephemeral: true });
            }
        }

        if (interaction.customId === 'adicionar_membro') {
            if (!isStaff) return interaction.reply({ content: '❌ Apenas membros da equipe podem adicionar usuários.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId('modal_add_membro').setTitle('Adicionar Membro');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('user_id').setLabel('ID do Usuário').setStyle(TextInputStyle.Short).setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'remover_membro') {
            if (!isStaff) return interaction.reply({ content: '❌ Apenas membros da equipe podem remover usuários.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId('modal_rem_membro').setTitle('Remover Membro');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('user_id').setLabel('ID do Usuário').setStyle(TextInputStyle.Short).setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'fechar_ticket') {
            const modal = new ModalBuilder()
                .setCustomId('modal_fechar_ticket')
                .setTitle('Fechar Ticket');

            const reasonInput = new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Motivo do fechamento do ticket')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            return interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_fechar_ticket') {
        const reason = interaction.fields.getTextInputValue('reason');
        const ticketData = activeTickets.get(interaction.channel.id);

        if (ticketData && ticketData.timeoutId) clearTimeout(ticketData.timeoutId);

        await interaction.reply('🔒 Gerando transcript e encerrando o ticket...');

        const transcriptFile = await generateTranscript(interaction.channel);

        const attendantMention = ticketData?.staffId ? `<@${ticketData.staffId}>` : 'Ninguém assumiu';
        const userMention = ticketData?.userId ? `<@${ticketData.userId}>` : 'Não identificado';

        const logEmbed = new EmbedBuilder()
            .setTitle('📑 TICKET ENCERRADO')
            .setColor('#FF3838')
            .addFields(
                { name: 'ID do Ticket:', value: ticketData?.ticketId ? `\`${ticketData.ticketId}\`` : 'N/A', inline: true },
                { name: 'Categoria:', value: ticketData?.category ? ticketData.category.toUpperCase() : 'N/A', inline: true },
                { name: 'Dono do Ticket:', value: userMention, inline: false },
                { name: 'Atendido por:', value: attendantMention, inline: true },
                { name: 'Fechado por:', value: `${interaction.user}`, inline: true },
                { name: 'Motivo do Fechamento:', value: reason }
            )
            .setTimestamp();

        const transcriptChannel = client.channels.cache.get(TRANSCRIPT_CHANNEL_ID);
        if (transcriptChannel) {
            await transcriptChannel.send({ embeds: [logEmbed], files: [transcriptFile] }).catch(() => {});
        }

        const user = await client.users.fetch(ticketData?.userId).catch(() => null);
        if (user && ticketData?.staffId) {
            const evalMenu = new StringSelectMenuBuilder()
                .setCustomId(`eval_${ticketData.staffId}_${ticketData.category}_${ticketData.ticketId}`)
                .setPlaceholder('Avalie o atendimento recebido (1 a 5 estrelas)')
                .addOptions([
                    { label: '⭐ 5 Estrelas - Excelente', value: '5' },
                    { label: '⭐ 4 Estrelas - Muito Bom', value: '4' },
                    { label: '⭐ 3 Estrelas - Razoável', value: '3' },
                    { label: '⭐ 2 Estrelas - Ruim', value: '2' },
                    { label: '⭐ 1 Estrela - Péssimo', value: '1' }
                ]);

            await user.send({
                content: `Seu ticket foi finalizado.\n**Motivo:** ${reason}\n\nComo foi o atendimento recebido? Por favor, selecione sua nota:`,
                components: [new ActionRowBuilder().addComponents(evalMenu)]
            }).catch(() => {});
        }

        setTimeout(() => {
            activeTickets.delete(interaction.channel.id);
            interaction.channel.delete().catch(() => {});
        }, 3000);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_add_membro') {
        const userId = interaction.fields.getTextInputValue('user_id');
        await interaction.channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
        return interaction.reply({ content: `✅ Membro <@${userId}> adicionado ao ticket!`, ephemeral: true });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_rem_membro') {
        const userId = interaction.fields.getTextInputValue('user_id');
        await interaction.channel.permissionOverwrites.delete(userId);
        return interaction.reply({ content: `✅ Membro <@${userId}> removido do ticket!`, ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('eval_')) {
        const [, staffId, category, ticketId] = interaction.customId.split('_');
        const rating = interaction.values[0];

        const modal = new ModalBuilder()
            .setCustomId(`modal_eval_${staffId}_${category}_${ticketId}_${rating}`)
            .setTitle('Deixe um comentário');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('comment')
                    .setLabel('Comentário sobre o atendimento')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
            )
        );

        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_eval_')) {
        const [, , staffId, category, ticketId, ratingStr] = interaction.customId.split('_');
        const rating = parseFloat(ratingStr);
        const comment = interaction.fields.getTextInputValue('comment');
        
        const staffUser = await client.users.fetch(staffId);
        
        const stats = userStats.get(staffId) || { totalRating: 0, count: 0 };
        stats.totalRating += rating;
        stats.count += 1;
        userStats.set(staffId, stats);

        const avgRating = (stats.totalRating / stats.count).toFixed(1);

        const canvas = createCanvas(800, 250);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0b132b';
        ctx.roundRect(10, 10, 780, 230, 15);
        ctx.fill();
        ctx.strokeStyle = '#38b6ff'; 
        ctx.lineWidth = 3;
        ctx.stroke();

        const avatarUrl = staffUser.displayAvatarURL({ extension: 'png', size: 128 });
        const avatar = await loadImage(avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(90, 125, 50, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar, 40, 75, 100, 100);
        ctx.restore();

        ctx.strokeStyle = '#38b6ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(90, 125, 50, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#38b6ff';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`NOVA AVALIAÇÃO · ${category.toUpperCase()}`, 160, 55);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText(staffUser.username, 160, 90);

        ctx.fillStyle = '#38b6ff';
        ctx.font = '26px sans-serif';
        const starsText = '★'.repeat(rating) + '☆'.repeat(5 - rating);
        ctx.fillText(`${starsText}  ${rating.toFixed(1)}`, 160, 125);

        ctx.strokeStyle = '#38b6ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(160, 140);
        ctx.lineTo(600, 140);
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'italic 18px sans-serif';
        ctx.fillText(`"${comment}"`, 160, 175);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px sans-serif';
        const dateStr = new Date().toLocaleDateString('pt-BR');
        ctx.fillText(`por ${interaction.user.username} · Ticket ${ticketId} · ${dateStr}`, 160, 205);

        ctx.fillStyle = '#1c2541';
        ctx.roundRect(620, 45, 140, 150, 10);
        ctx.fill();
        ctx.strokeStyle = '#38b6ff';
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('MÉDIA GERAL', 648, 75);

        ctx.fillStyle = '#38b6ff';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(avgRating, 665, 125);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px sans-serif';
        ctx.fillText(`${stats.count} avaliações`, 655, 165);

        const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'avaliacao.png' });
        const evalChannel = client.channels.cache.get(EVAL_CHANNEL_ID);
        if (evalChannel) {
            await evalChannel.send({ files: [attachment] });
        }

        await interaction.reply({ content: '✅ Sua avaliação foi publicada no servidor! Obrigado.', ephemeral: true });
    }
});

process.on('unhandledRejection', error => {
    console.error('❌ Erro não tratado:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Exceção não tratada:', error);
});

client.login(process.env.DISCORD_TOKEN);