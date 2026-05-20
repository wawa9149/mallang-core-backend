import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ChatsModule } from './chats/chats.module';
import { envValidationSchema } from './config/env.validation';
import { CryptoModule } from './crypto/crypto.module';
import { LunchVotesModule } from './lunch-votes/lunch-votes.module';
import { OpenAiModule } from './openai/openai.module';
import { PrismaModule } from './prisma/prisma.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { SttModule } from './stt/stt.module';
import { TeamsModule } from './teams/teams.module';
import { TtsModule } from './tts/tts.module';
import { UsersModule } from './users/users.module';
import { VisitRecordsModule } from './visit-records/visit-records.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: envValidationSchema,
    }),
    PrismaModule,
    CryptoModule,
    UsersModule,
    AuthModule,
    RestaurantsModule,
    TeamsModule,
    LunchVotesModule,
    OpenAiModule,
    ChatsModule,
    TtsModule,
    SttModule,
    VisitRecordsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
