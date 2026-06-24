import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { CreateCsCommentDto } from '../dto/create-cs-comment.dto';
import { EditCsCommentDto } from '../dto/edit-cs-comment.dto';
import { CsCommentsService } from '../services/cs-comments.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('CS Comments')
@Controller('cs-cases/:caseId/comments')
export class CsCaseCommentsController {
  constructor(private readonly service: CsCommentsService) {}

  @Post()
  @ApiOperation({ summary: '댓글 작성(멘션/첨부 포함)' })
  @ApiParam({ name: 'caseId' })
  add(@Param('caseId') caseId: string, @Body() dto: CreateCsCommentDto, @User() user: AuthenticatedUser) {
    return this.service.addComment(caseId, dto, this.getUserId(user));
  }

  @Patch(':commentId')
  @ApiOperation({ summary: '댓글 수정(작성자 본인만)' })
  @ApiParam({ name: 'caseId' })
  @ApiParam({ name: 'commentId' })
  edit(@Param('commentId') commentId: string, @Body() dto: EditCsCommentDto, @User() user: AuthenticatedUser) {
    return this.service.editComment(commentId, dto, this.getUserId(user));
  }

  @Delete(':commentId')
  @ApiOperation({ summary: '댓글 삭제(소프트, 작성자 본인만)' })
  @ApiParam({ name: 'caseId' })
  @ApiParam({ name: 'commentId' })
  remove(@Param('commentId') commentId: string, @User() user: AuthenticatedUser) {
    return this.service.deleteComment(commentId, this.getUserId(user));
  }

  private getUserId(user: AuthenticatedUser): string {
    const id = user?.id ?? user?.userId ?? user?.sub;
    if (!id) throw new Error('Authenticated user id missing');
    return id;
  }
}
