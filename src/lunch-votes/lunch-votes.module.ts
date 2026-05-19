import { Module } from '@nestjs/common';
import { LunchSuggestionService } from './lunch-suggestion.service';
import { LunchVotesController } from './lunch-votes.controller';
import { LunchVotesService } from './lunch-votes.service';

@Module({
  controllers: [LunchVotesController],
  providers: [LunchVotesService, LunchSuggestionService],
})
export class LunchVotesModule {}
