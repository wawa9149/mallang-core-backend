import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { OpenAiService } from './openai.service';

@Module({
  imports: [UsersModule],
  providers: [OpenAiService],
  exports: [OpenAiService],
})
export class OpenAiModule {}
